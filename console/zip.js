// @ts-check
// A small zip reader for the song bundles other apps save (ProPresenter's .probundle and .proplaylist files). It
// walks the files' own headers rather than the directory at the end, because ProPresenter writes that directory
// with the wrong length, and so do other tools now and then. No DOM, so it runs under Node as well.

const u16 = (b, i) => b[i] | b[i + 1] << 8;
const u32 = (b, i) => (b[i] | b[i + 1] << 8 | b[i + 2] << 16 | b[i + 3] << 24) >>> 0;
const u64 = (b, i) => u32(b, i) + u32(b, i + 4) * 2 ** 32;
const LOCAL = 0x04034b50, DESCRIPTOR = 0x08074b50;

export const isZip = b => b.length >= 4 && u32(b, 0) === LOCAL;

async function inflate(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The files in a zip as [{ name, data }], in the order they are stored, keeping only those whose name `want`
 * accepts (so a bundle's pictures and videos aren't unpacked). Stored and deflated files are read; others are
 * skipped. Throws for something that isn't a zip.
 * @param {Uint8Array} bytes @param {(name: string) => boolean} [want] */
export async function unzip(bytes, want = () => true) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!isZip(b)) throw new Error('not a zip file');
  const out = [];
  let at = 0;
  while (at + 30 <= b.length && u32(b, at) === LOCAL) {
    const flags = u16(b, at + 6), method = u16(b, at + 8), nameLen = u16(b, at + 26), extraLen = u16(b, at + 28);
    let size = u32(b, at + 18), full = u32(b, at + 22);
    const name = new TextDecoder().decode(b.subarray(at + 30, at + 30 + nameLen));
    const start = at + 30 + nameLen + extraLen;
    // Zip64: sizes too big for the header (or written as if they were) are in an extra field, full size first.
    for (let e = at + 30 + nameLen; e + 4 <= start;) {
      const id = u16(b, e), len = u16(b, e + 2);
      if (id === 1) {
        let p = e + 4;
        if (full === 0xffffffff) { full = u64(b, p); p += 8; }
        if (size === 0xffffffff) size = u64(b, p);
      }
      e += 4 + len;
    }
    let next = start + size;
    if (flags & 8) { // the sizes follow the data, so find the descriptor whose size matches the distance to it
      next = -1;
      for (let d = start; (d = b.indexOf(0x50, d)) >= 0 && d + 16 <= b.length; d++) {
        if (u32(b, d) !== DESCRIPTOR) continue;
        if (u32(b, d + 8) === d - start) { size = d - start; next = d + 16; break; }
        if (d + 24 <= b.length && u64(b, d + 8) === d - start) { size = d - start; next = d + 24; break; }
      }
      if (next < 0) break;
    }
    if (next > b.length) break;
    if (!name.endsWith('/') && want(name) && (method === 0 || method === 8)) {
      const raw = b.subarray(start, start + size);
      out.push({ name, data: method === 8 ? await inflate(raw) : raw.slice() });
    }
    at = next;
  }
  return out;
}
