// A small read-only SQLite reader for the song libraries other apps keep as SQLite files (EasyWorship 6's Songs.db
// and SongWords.db). It walks a table's pages and decodes its rows: no SQL, no indexes, no journal. No DOM, so it
// runs under Node as well.

const MAGIC = 'SQLite format 3\0';
export const isSqlite = b => b.length >= 100 && String.fromCharCode(...b.subarray(0, 16)) === MAGIC;

/** A SQLite file's tables: { name: { columns, rows } }, each row an object by column name (its rowid as `rowid`,
 * and in a column declared INTEGER PRIMARY KEY). Only the tables `want` names are read. Throws for something that
 * isn't a SQLite file. */
export function readSqlite(bytes, want = () => true) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!isSqlite(b)) throw new Error('not a SQLite file');
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const pageSize = view.getUint16(16) === 1 ? 65536 : view.getUint16(16), usable = pageSize - b[20];
  const text = new TextDecoder(['utf-8', 'utf-8', 'utf-16le', 'utf-16be'][view.getUint32(56)] || 'utf-8');
  const page = n => {
    if (n < 1 || n * pageSize > b.length) throw new Error('a page past the end of the file');
    return (n - 1) * pageSize;
  };
  const varint = at => varintIn(b, at);
  // A cell's payload: the part on its page, then the overflow pages it chains to.
  const payload = (at, size) => {
    const max = usable - 35;
    if (size <= max) return b.subarray(at, at + size);
    const min = Math.floor((usable - 12) * 32 / 255) - 23;
    let local = min + (size - min) % (usable - 4);
    if (local > max) local = min;
    const out = new Uint8Array(size);
    out.set(b.subarray(at, at + local));
    let got = local, next = view.getUint32(at + local), hops = 0;
    while (got < size && next && hops++ < b.length / pageSize) {
      const p = page(next), n = Math.min(usable - 4, size - got);
      out.set(b.subarray(p + 4, p + 4 + n), got);
      got += n; next = view.getUint32(p);
    }
    if (got < size) throw new Error('a row runs past its overflow pages');
    return out;
  };
  const record = data => {
    const [headerSize, first] = varintIn(data, 0);
    const types = [];
    for (let at = first; at < headerSize;) { const [t, next] = varintIn(data, at); types.push(t); at = next; }
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let at = headerSize;
    return types.map(t => {
      if (t === 0) return null;
      if (t === 8) return 0;
      if (t === 9) return 1;
      if (t === 7) { at += 8; return dv.getFloat64(at - 8); }
      if (t <= 6) {
        const n = [0, 1, 2, 3, 4, 6, 8][t];
        let v = 0;
        for (let i = 0; i < n; i++) v = v * 256 + data[at + i];
        if (data[at] & 0x80) v -= 2 ** (8 * n);
        at += n;
        return v;
      }
      const n = Math.floor((t - 12) / 2), v = data.subarray(at, at + n);
      at += n;
      return t % 2 ? text.decode(v) : v.slice();
    });
  };
  // Every row of a table, by walking its b-tree from the root page.
  const rows = root => {
    const out = [], stack = [root], seen = new Set();
    while (stack.length) {
      const n = stack.pop();
      if (seen.has(n)) continue;
      seen.add(n);
      const start = page(n), head = start + (n === 1 ? 100 : 0), type = b[head], count = view.getUint16(head + 3);
      const cells = head + (type === 5 ? 12 : 8);
      if (type === 5) {
        const children = [];
        for (let i = 0; i < count; i++) children.push(view.getUint32(start + view.getUint16(cells + i * 2)));
        children.push(view.getUint32(head + 8));
        stack.push(...children.reverse()); // left to right, so rows come out in rowid order
      } else if (type === 13) {
        for (let i = 0; i < count; i++) {
          let at = start + view.getUint16(cells + i * 2);
          const [size, a] = varint(at), [rowid, c] = varint(a);
          at = c;
          out.push([rowid, record(payload(at, size))]);
        }
      } else throw new Error('not a table page');
    }
    return out;
  };

  const tables = {};
  for (const [, [type, name, , root, sql]] of rows(1)) {
    if (type !== 'table' || !want(name) || !root) continue;
    const columns = columnsOf(sql || '');
    const alias = columnDefs(sql).findIndex(d => /\binteger\s+primary\s+key\b/i.test(d));
    tables[name] = {
      columns: columns.map(c => c.name),
      rows: rows(root).map(([rowid, values]) => {
        const row = { rowid };
        columns.forEach((c, i) => { row[c.name] = i === alias ? rowid : values[i] ?? null; });
        return row;
      }),
    };
  }
  return tables;
}

/** A SQLite varint at a place in bytes: [its value, where the next thing starts]. */
function varintIn(b, at) {
  let v = 0;
  for (let i = 0; i < 9; i++) {
    const c = b[at + i];
    if (i === 8) return [v * 256 + c, at + 9];
    v = v * 128 + (c & 0x7f);
    if (c < 0x80) return [v, at + i + 1];
  }
}

/** The column definitions in a CREATE TABLE statement, split on the commas between them (not those in brackets),
 * leaving out table constraints. */
function columnDefs(sql) {
  const body = sql.slice(sql.indexOf('(') + 1, sql.lastIndexOf(')'));
  const defs = [];
  let depth = 0, cur = '', quote = '';
  for (const ch of body) {
    if (quote) { if (ch === quote) quote = ''; }
    else if ('"\'`['.includes(ch)) quote = ch === '[' ? ']' : ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && !depth) { defs.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) defs.push(cur.trim());
  return defs.filter(d => !/^(constraint|primary\s+key|unique|check|foreign\s+key)\b/i.test(d));
}
const columnsOf = sql => columnDefs(sql).map(d => ({ name: (/^("[^"]*"|`[^`]*`|\[[^\]]*\]|\S+)/.exec(d)[1]).replace(/^["`[]|["`\]]$/g, '') }));

/** The names of a SQLite file's tables, without reading their rows. */
export function tableNames(bytes) {
  const names = [];
  readSqlite(bytes, name => { names.push(name); return false; });
  return names;
}
