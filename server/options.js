// The command line and LUMEN_* environment variables.
'use strict';
const path = require('path');
const { parseArgs } = require('util');
const { APP_DIR } = require('./request.js');

function options(argv = process.argv.slice(2), env = process.env) {
  const { values: v } = parseArgs({
    args: argv,
    options: {
      host: { type: 'string' }, port: { type: 'string' }, data: { type: 'string' }, token: { type: 'string' },
      'allowed-host': { type: 'string', multiple: true }, 'max-upload-mb': { type: 'string' },
      'media-folder': { type: 'string', multiple: true },
      verbose: { type: 'boolean', short: 'v' }, help: { type: 'boolean', short: 'h' },
    },
  });
  if (v.help) {
    console.log(`usage: node server.js [--host HOST] [--port PORT] [--data DIR] [--token TOKEN]
                      [--allowed-host NAME ...] [--media-folder DIR ...] [--max-upload-mb MB] [-v]

  --host           address to bind, fixing network mode (0.0.0.0 for all interfaces); default: 127.0.0.1,
                   or 0.0.0.0 once network mode is switched on in the console
  --port           default 8642
  --data           directory for the library, media and live state (default ./data)
  --token          require this token for any change, even locally (default: a generated one, kept in the
                   data directory and required in network mode)
  --allowed-host   a host name Lumen is reached by through a reverse proxy, e.g. lumen.example.org
                   (repeatable; IP addresses, localhost and this computer's name are always accepted)
  --media-folder   a folder of pictures and videos to play from where they are, with no upload (repeatable;
                   more can be added in the console)
  --max-upload-mb  default 4096
  -v, --verbose    log every request`);
    process.exit(0);
  }
  const int = (s, name) => {
    const n = Number(s);
    if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a whole number`);
    return n;
  };
  return {
    host: v.host || env.LUMEN_HOST || null,
    port: int(v.port ?? env.LUMEN_PORT ?? 8642, '--port'),
    data: v.data || env.LUMEN_DATA || path.join(APP_DIR, 'data'),
    token: v.token ?? env.LUMEN_TOKEN ?? '',
    allowedHosts: [...(env.LUMEN_ALLOWED_HOSTS || '').split(','), ...(v['allowed-host'] || [])],
    mediaFolders: [...(env.LUMEN_MEDIA_FOLDERS || '').split(path.delimiter), ...(v['media-folder'] || [])].filter(Boolean),
    maxUploadMb: int(v['max-upload-mb'] ?? env.LUMEN_MAX_UPLOAD_MB ?? 4096, '--max-upload-mb'),
    verbose: !!v.verbose,
  };
}

module.exports = { options };
