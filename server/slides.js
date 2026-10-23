// @ts-check
// Turning a PowerPoint (or Impress, or PDF) file into one picture per slide, with what this computer has:
// PowerPoint itself on Windows, then LibreOffice, then pdftoppm for a PDF. Pictures look exactly like the slides,
// fonts and all, which is what sermon slides need; animations and slide transitions are not kept.
'use strict';
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SLIDE_EXT = new Set(['pptx', 'ppt', 'ppsx', 'pps', 'odp', 'pdf']);
const POWERPOINT_EXT = new Set(['pptx', 'ppt', 'ppsx', 'pps']);
const WIDTH = 1920;
const TIMEOUT = 10 * 60 * 1000; // a long deck of photos takes a while; a stuck converter doesn't hold the next import
const NO_UNO = 3; // slides-uno.py's exit code when its Python has no uno module
// Read here and passed with -c, so it also runs from inside the desktop app's archive.
const UNO_SCRIPT = path.join(__dirname, 'slides-uno.py');

const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: TIMEOUT, windowsHide: true, maxBuffer: 16 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
    if (!err) return resolve(String(stdout));
    const output = String(stderr || '').trim();
    reject(Object.assign(err, { output, detail: output.split('\n').pop() || err.message }));
  });
});
const isFile = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const onPath = (names, env) => (env.PATH || '').split(path.delimiter).filter(Boolean)
  .flatMap(d => names.map(n => path.join(d, n))).find(isFile);

/** LibreOffice's soffice: LUMEN_SOFFICE, else where its installers put it. */
function findSoffice(env = process.env, platform = process.platform) {
  if (env.LUMEN_SOFFICE) return isFile(env.LUMEN_SOFFICE) ? env.LUMEN_SOFFICE : null;
  if (platform === 'win32') {
    return [env.ProgramFiles, env['ProgramFiles(x86)'], 'C:\\Program Files'].filter(Boolean)
      .map(d => path.join(d, 'LibreOffice', 'program', 'soffice.exe')).find(isFile) || null;
  }
  let opt = [];
  try { opt = fs.readdirSync('/opt').filter(d => d.startsWith('libreoffice')).sort().reverse(); } catch {}
  return onPath(['soffice', 'libreoffice'], env) || ['/usr/lib/libreoffice/program/soffice',
    ...opt.map(d => `/opt/${d}/program/soffice`), '/Applications/LibreOffice.app/Contents/MacOS/soffice'].find(isFile) || null;
}

/** A Python that can drive LibreOffice: the one it comes with (Windows, and its own Linux builds), else the
 * system's, which has uno when the distribution's LibreOffice is installed with its Python support. */
function findPython(soffice, env = process.env, platform = process.platform) {
  let dir = path.dirname(soffice);
  try { dir = path.dirname(fs.realpathSync(soffice)); } catch {}
  const own = [path.join(dir, platform === 'win32' ? 'python.exe' : 'python'), path.join(dir, '..', 'Resources', 'python')];
  return own.find(isFile) || onPath(platform === 'win32' ? ['python.exe'] : ['python3'], env) || null;
}

// Through PowerPoint, so a deck looks exactly as it does there. Paths go in the environment, never in the script.
const POWERPOINT_SCRIPT = `
$ErrorActionPreference = 'Stop'
trap { [Console]::Error.WriteLine("$($_.Exception.Message) (line $($_.InvocationInfo.ScriptLineNumber))"); exit 1 }
$app = New-Object -ComObject PowerPoint.Application
$security = $app.AutomationSecurity
$app.AutomationSecurity = 3 # never run the file's macros
try {
  $pres = $app.Presentations.Open($env:LUMEN_SRC, -1, 0, 0) # read-only, untitled off, no window
  try {
    $w = [int]$env:LUMEN_WIDTH
    $h = [int][Math]::Round($w * $pres.PageSetup.SlideHeight / $pres.PageSetup.SlideWidth)
    $n = 0
    foreach ($s in $pres.Slides) {
      if ($s.SlideShowTransition.Hidden) { continue }
      $n++
      $s.Export((Join-Path $env:LUMEN_OUT ('{0:d4}.png' -f $n)), 'PNG', $w, $h)
    }
    $n
  } finally { $pres.Close() }
} finally {
  $app.AutomationSecurity = $security
  if ($app.Presentations.Count -eq 0) { $app.Quit() } # PowerPoint was already open with something in it: leave it be
}`;
async function viaPowerPoint(src, out) {
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
    Buffer.from(POWERPOINT_SCRIPT, 'utf16le').toString('base64')],
  { env: { ...process.env, LUMEN_SRC: src, LUMEN_OUT: out, LUMEN_WIDTH: String(WIDTH) } });
}

async function viaLibreOffice(soffice, src, out, work) {
  const python = findPython(soffice);
  const profile = path.join(work, 'profile');
  if (python) {
    try {
      await run(python, ['-c', fs.readFileSync(UNO_SCRIPT, 'utf8'), soffice, profile, src, out, String(WIDTH)]);
      return;
    } catch (e) {
      if (e.code !== NO_UNO) throw e;
    }
  }
  // No uno for Python: LibreOffice makes a PDF, and pdftoppm draws its pages.
  const pdftoppm = findPdftoppm();
  if (!pdftoppm) throw new Error('install LibreOffice’s Python support (python3-uno) or poppler-utils');
  await run(soffice, [`-env:UserInstallation=${pathToFileURL(profile).href}`, '--headless', '--norestore', '--nolockcheck',
    '--convert-to', 'pdf', '--outdir', work, src]);
  const pdf = path.join(work, path.basename(src).replace(/\.[^.]+$/, '') + '.pdf');
  if (!isFile(pdf)) throw new Error('LibreOffice could not open the file');
  await viaPdftoppm(pdftoppm, pdf, out);
}

const findPdftoppm = (env = process.env) => onPath(process.platform === 'win32' ? ['pdftoppm.exe'] : ['pdftoppm'], env) || null;
const viaPdftoppm = (pdftoppm, pdf, out) => run(pdftoppm, ['-png', '-scale-to-x', String(WIDTH), '-scale-to-y', '-1', pdf, path.join(out, 's')]);

/** The pictures a converter left in out, in slide order. */
const pictures = out => fs.readdirSync(out).filter(f => f.endsWith('.png'))
  .sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).map(f => path.join(out, f));

/** Convert src (named for its type, e.g. slides.pptx) into PNGs; work is an empty folder to use. Resolves to
 * {files, via}. Tries each way this computer has, and says what is missing if there is none. */
async function convert(src, work) {
  const ext = path.extname(src).slice(1).toLowerCase();
  const out = path.join(work, 'out');
  const ways = [];
  if (process.platform === 'win32' && POWERPOINT_EXT.has(ext)) ways.push(['PowerPoint', () => viaPowerPoint(src, out)]);
  const pdftoppm = ext === 'pdf' && findPdftoppm();
  if (pdftoppm) ways.push(['pdftoppm', () => viaPdftoppm(pdftoppm, src, out)]);
  const soffice = findSoffice();
  if (soffice) ways.push(['LibreOffice', () => viaLibreOffice(soffice, src, out, work)]);
  if (!ways.length) {
    throw new Error(process.platform !== 'win32' ? 'importing slides needs LibreOffice on the computer running Lumen'
      : ext === 'pdf' ? 'importing a PDF needs LibreOffice on the computer running Lumen (PowerPoint can’t open PDFs)'
      : 'importing slides needs Microsoft PowerPoint or LibreOffice on the computer running Lumen');
  }
  const failed = [], log = [];
  for (const [via, fn] of ways) {
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    try {
      await fn();
      const files = pictures(out);
      if (files.length) return { files, via };
      failed.push(`${via}: no slides`);
    } catch (e) {
      failed.push(`${via}: ${e.killed ? 'took too long' : e.detail || e.message}`);
      const why = e.killed ? 'took too long' : typeof e.code === 'number' ? `stopped with exit code ${e.code}` : e.message;
      log.push(`${via}: ${why}${e.output ? '\n' + e.output : ''}`);
    }
  }
  // The message is shown in the console; the log, with everything each converter said, goes in the import log.
  throw Object.assign(new Error(`could not convert the slides (${failed.join('; ')})`), { log: log.join('\n') });
}

// One at a time: each conversion starts its own PowerPoint or LibreOffice, and they are heavy.
let queue = /** @type {Promise<unknown>} */ (Promise.resolve());
function convertQueued(src, work) {
  const job = queue.then(() => convert(src, work));
  queue = job.catch(() => {});
  return job;
}

module.exports = { SLIDE_EXT, WIDTH, convert: convertQueued, findSoffice, findPython };
