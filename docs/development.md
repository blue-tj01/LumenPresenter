# Development

## Layout

There is no build step: edit the HTML, CSS and JavaScript files and reload. The console's scripts are ES modules, loaded by the browser as they are.

| File | Contents |
| --- | --- |
| `server.js` | Starts the server, using Node's standard library only |
| `server/lumen-server.js`, `server/request.js` | Listening, network mode, and handling each request: sign-in, checks and files |
| `server/api/` | The HTTP API, one file per area (library and live state, media and folders, network, events) |
| `server/store.js`, `server/library.js` | Settings, live state and backups, and the library's SQLite database |
| `server/bible/` | Bible translations: reading Zefania, OSIS and USFX files, references, and the translations database with its full-text search |
| `bibles/`, `scripts/bundle-bible.js` | The public-domain translations that come with Lumen, and the script that makes them from a Bible file |
| `server/slides.js`, `server/slides-uno.py` | Importing PowerPoint, Impress and PDF files as pictures, through PowerPoint, LibreOffice or pdftoppm |
| `console/powerpoint.js`, `vendor/pdfjs/` | Importing slides in the console; PDFs are drawn there with pdf.js |
| `server/folders.js`, `server/hub.js`, `server/media.js` | Media folders, live updates to open pages, and media file types |
| `electron/main.js` | The desktop app: starts the server in-process, opens the console window, and sets up the menus and tray icon |
| `electron/screens.js` | The desktop app's full-screen output and stage windows, and which display each goes on |
| `electron/ndi.js`, `electron/ndi-lib.js` | Sending the audience output over NDI, and the calls into the NDI Runtime |
| `electron/updates.js`, `electron/data.js` | Updates for the installed app, and importing a library from another data folder |
| `electron/preload.js` | The desktop app's folder picker, offered to the console |
| `.github/workflows/build.yml` | Tests, installers and releases on GitHub Actions |
| `index.html`, `app.css`, `console/` | The operator console; `console/main.js` loads the library and wires up the page, and each other file is one part of it (views, editor, media, themes, timer, network) |
| `console/undo.js` | Undo and redo of library changes, keeping only what each step changed |
| `console/setup.js` | The first-run setup on a new library: demo songs, screens, importing, the look of the words |
| `console/dialog.js`, `console/backups.js` | Questions in the console's own dialog instead of `confirm()`; the Library dialog (export, import, backups, starting over) |
| `console/songselect.js`, `console/openlyrics.js`, `console/xml.js`, `console/propresenter.js`, `console/zip.js`, `console/easyworship.js`, `console/rtf.js`, `console/sqlite.js` | Importing songs from SongSelect, OpenLyrics, OpenSong, ProPresenter and EasyWorship files |
| `console/usage.js`, `console/report.js` | Noting which songs went live, and the CCLI usage report dialog |
| `console/passage.js` | Bible passages as slides: packing verses and splitting long ones |
| `console/format.js` | The slide format: presentations, templates and layouts of positioned elements, converting libraries saved by earlier versions, and resolving a slide into what a screen draws |
| `console/words.js`, `console/word-bar.js` | Bold, italic, underlined and coloured words, written as marks in a slide's text and resolved into runs the screens draw; the formatting bar over a box of words |
| `console/layout-editor.js`, `console/layout-model.js` | The layout editor for themes, their other layouts, designed slides and the stage display, and its snapping, resizing, picking, undo and starting a design from a theme, which need no page and are tested under Node |
| `console/transitions.js` | The slide transitions, and which one a presentation plays |
| `server/control.js`, `server/osc.js`, `console/control.js`, `console/midi.js` | Outside control: the commands, the OSC listener, the Control tab, and MIDI |
| `companion-module/` | The Bitfocus Companion module, with its own `package.json` |
| `output.html`, `stage.html`, `render.js`, `render.css` | The audience output and stage display, and playing transitions |
| `sync.js` | The pages' link to the server |
| `docs/` | The user and developer guides linked from the README |

## Tests

Run the tests with:

```bash
npm test
```

The NDI tests use a stand-in for NDI. To also send real frames, set `LUMEN_NDI_LIB` to the NDI library (for example `libndi.so.6`, or `Processing.NDI.Lib.x64.dll` in the NDI Runtime folder on Windows) before running them.

The console is also tested in a real browser (Chromium, through Playwright): writing a song and putting it on the audience output, two operators changing songs at once, starting over and restoring a backup, and the layout editor. Install Chromium once with `npx playwright install chromium`, then:

```bash
npm run test:e2e
```

To use a Chromium already on the computer instead, set `LUMEN_CHROMIUM` to its path.

## Checks

```bash
npm run lint       # ESLint's recommended rules: undefined names, unused variables, unreachable code
npm run typecheck  # TypeScript, over the files that start with // @ts-check
npm run check      # both, then the tests
```

Type checking is turned on a file at a time: a file that starts with `// @ts-check` is checked, the rest are not yet. JSDoc comments (`/** @type {...} */`, `@param`, `@returns`) give the types where they can't be worked out. `types/globals.d.ts` describes the pages' shared globals (`Lumen` from `sync.js`, `PP` from `render.js`). To check another file, add the line, run `npm run typecheck`, and fix or annotate what it finds.

GitHub Actions runs the tests, lint and type checks on Windows and Linux for every pull request, and the browser tests on Linux. Each push to `main` also builds the installers, which can be downloaded from the run's **Artifacts**. `npm run dist` builds them locally, into `dist/`.

## Releasing

1. Move the notes under **Unreleased** in `CHANGELOG.md` under the new version's number, and commit.
2. Set the new version: `npm version minor` (or `patch`), which updates `package.json` and makes a `v<version>` tag.
3. Push it: `git push --follow-tags`.

The tag's build publishes the Windows and Linux installers, and the Companion module package, as a GitHub release, and installed copies update from it. Updates need the repository to be public, since installed copies download releases without signing in.

## macOS

Not built yet. Lumen runs on a Mac from the source, but a downloadable Mac app needs an Apple Developer account (about $99 a year) to sign and notarise it, or macOS refuses to open it and it can't update itself. Adding it later is a `mac` target in `package.json` and a macOS runner in the workflow.
