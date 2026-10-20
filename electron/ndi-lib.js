// The NDI library, called directly. Lumen doesn't ship it: it uses the NDI Runtime that NDI Tools (or the NDI
// redistributable) installs, found as the NDI SDK says to, through the NDI_RUNTIME_DIR_V6 folder.
'use strict';
const path = require('path');

const RUNTIME_URL = 'https://ndi.video/tools/';

/** Where the NDI library may be on this computer, most specific first. */
function candidates(env = process.env, platform = process.platform) {
  const dir = env.NDI_RUNTIME_DIR_V6;
  if (env.LUMEN_NDI_LIB) return [env.LUMEN_NDI_LIB];
  if (platform === 'win32') {
    const name = `Processing.NDI.Lib.${process.arch === 'ia32' ? 'x86' : 'x64'}.dll`;
    return [...dir ? [path.join(dir, name)] : [], name];
  }
  if (platform === 'darwin') {
    return [...dir ? [path.join(dir, 'libndi.dylib')] : [], '/Library/NDI SDK for Apple/lib/macOS/libndi.dylib', '/usr/local/lib/libndi.dylib'];
  }
  return [...dir ? [path.join(dir, 'libndi.so.6')] : [], 'libndi.so.6', 'libndi.so'];
}

/** Load NDI and return what Lumen uses of it, or throw an Error whose message suits the menu. */
function open({ env = process.env, koffi = require('koffi') } = {}) {
  let lib = null;
  for (const file of candidates(env)) {
    try { lib = koffi.load(file); break; } catch {}
  }
  if (!lib) {
    const e = new Error('Install NDI Tools to send over NDI');
    e.code = 'NDI_MISSING';
    throw e;
  }

  // From the NDI 6 SDK headers (Processing.NDI.Lib.h, Processing.NDI.structs.h, Processing.NDI.Send.h). The types
  // are unnamed so the library can be opened more than once.
  const SendCreate = koffi.struct({
    p_ndi_name: 'const char *', p_groups: 'const char *', clock_video: 'bool', clock_audio: 'bool' });
  const VideoFrame = koffi.struct({
    xres: 'int', yres: 'int', FourCC: 'int', frame_rate_N: 'int', frame_rate_D: 'int', picture_aspect_ratio: 'float',
    frame_format_type: 'int', timecode: 'int64_t', p_data: 'uint8_t *', line_stride_in_bytes: 'int',
    p_metadata: 'const char *', timestamp: 'int64_t' });
  const Source = koffi.struct({ p_ndi_name: 'const char *', p_url_address: 'const char *' });
  const Instance = koffi.pointer(koffi.opaque());

  const initialize = lib.func('NDIlib_initialize', 'bool', []);
  const version = lib.func('NDIlib_version', 'const char *', []);
  const create = lib.func('NDIlib_send_create', Instance, [koffi.pointer(SendCreate)]);
  const destroy = lib.func('NDIlib_send_destroy', 'void', [Instance]);
  const sendVideo = lib.func('NDIlib_send_send_video_v2', 'void', [Instance, koffi.pointer(VideoFrame)]);
  const connections = lib.func('NDIlib_send_get_no_connections', 'int', [Instance, 'uint32_t']);
  const sourceName = lib.func('NDIlib_send_get_source_name', koffi.pointer(Source), [Instance]);

  if (!initialize()) throw new Error('NDI can’t run on this computer’s processor');
  const BGRA = 0x41524742; // NDI_LIB_FOURCC('B', 'G', 'R', 'A')
  const PROGRESSIVE = 1;
  const SYNTHESIZE = 0x7fffffffffffffffn; // NDIlib_send_timecode_synthesize: NDI fills in the timecode

  return {
    version: version(),
    /** A named NDI source. With clockVideo, each frame waits its turn, so frames go out at the frame rate. */
    send({ name, clockVideo = true }) {
      const inst = create({ p_ndi_name: name, p_groups: null, clock_video: clockVideo, clock_audio: false });
      if (!inst) throw new Error('NDI could not create the source');
      let closed = false;
      return {
        /** Send one BGRA picture. Resolves once NDI has it; runs off the main thread, as NDI waits to pace frames. */
        video({ width, height, fps, data }) {
          if (closed) return Promise.resolve();
          if (data.length < width * height * 4) return Promise.reject(new Error('NDI frame is smaller than its size'));
          const frame = { xres: width, yres: height, FourCC: BGRA, frame_rate_N: fps * 1000, frame_rate_D: 1000,
            picture_aspect_ratio: width / height, frame_format_type: PROGRESSIVE, timecode: SYNTHESIZE, p_data: data,
            line_stride_in_bytes: width * 4, p_metadata: null, timestamp: 0 };
          return new Promise((resolve, reject) => sendVideo.async(inst, frame, err => err ? reject(err) : resolve()));
        },
        connections() { return closed ? 0 : connections(inst, 0); },
        sourcename() { return closed ? '' : koffi.decode(sourceName(inst), Source).p_ndi_name || ''; },
        destroy() { if (!closed) { closed = true; destroy(inst); } },
      };
    },
  };
}

module.exports = { open, candidates, RUNTIME_URL };
