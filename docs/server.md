# Server, data and HTTP API

## Configuration

These options are for `node server.js`; the desktop app reads the same environment variables. Command-line options take precedence over the console. `--host` fixes the address (the Network switch is then shown but locked), and `--token` replaces the saved token and is required even locally.

| Option | Environment variable | Default |
| --- | --- | --- |
| `--host` | `LUMEN_HOST` | `127.0.0.1`, or `0.0.0.0` once network mode is on |
| `--port` | `LUMEN_PORT` | `8642` |
| `--data` | `LUMEN_DATA` | `./data` |
| `--token` | `LUMEN_TOKEN` | The generated token, required in network mode |
| `--allowed-host` | `LUMEN_ALLOWED_HOSTS` (comma-separated) | None; IP addresses, `localhost` and this computer's name always work |
| `--media-folder` | `LUMEN_MEDIA_FOLDERS` (separated by `;` on Windows, `:` elsewhere) | None; folders added in the console are kept in `settings.json`, and these can't be removed there |
| `--max-upload-mb` | `LUMEN_MAX_UPLOAD_MB` | `4096` |
| | `LUMEN_SOFFICE` | LibreOffice's `soffice`, for [importing slides](using-lumen.md#powerpoint-and-pdf-slides); found in its usual install folders |

### Running as a service

A systemd unit is provided in [`deploy/lumen.service`](../deploy/lumen.service).

### Behind a reverse proxy

- Pass `--token`, because requests relayed by a proxy on the same computer otherwise look local.
- Pass `--allowed-host` with the name the proxy serves Lumen under, if the proxy forwards that name (Caddy does; nginx only with `proxy_set_header Host`).
- Turn off response buffering for `/api/events` (nginx: `proxy_buffering off;`).
- Raise the request body limit if you upload videos.

### Without the server

The pages also work from any static host (for example `npx http-server`). In that mode the library is kept in the browser (IndexedDB), pictures are kept in the media bin and referenced as `@image: #<id>`, videos last for the current session only, and all windows must be on the same computer. The console's status indicator shows **Local only**.

## Data and backups

With the app or the server, everything lives in the data directory. For the installed app that is its own data folder (see [Install](install.md#install)); for `server.js` and the app run from the source it is the `data` folder next to `server.js`. `--data` or `LUMEN_DATA` overrides either.

| Path | Contents |
| --- | --- |
| `lumen.db` | The library: presentations, services, media list, themes and messages, in an SQLite database (with `lumen.db-wal` and `lumen.db-shm` beside it while Lumen is running) |
| `live.json` | What is on screen right now, so windows recover after a restart |
| `settings.json` | Network mode, the access token, signed-in devices and media folders (readable only by the account running the server) |
| `bibles.db` | The Bible translations in use and the ones imported, with their search index, in a database of their own |
| `media/` | Uploaded images and videos |
| `backups/` | Snapshots of the library as JSON: at most one every 10 minutes while it changes, plus one before every import, restore or start over. The newest 50 are kept, and the last of each day for 30 days before them |

Back up the data directory to back up everything (with Lumen closed, so the database is in one file).

Earlier versions kept the library in `library.json`. When Lumen starts and finds one there, it moves it into the database and keeps the file in `backups/before-database-<time>/`, so copying an old `library.json` into the data directory is still a way to restore it. **Library…** in the console's top bar exports and imports a portable JSON library, lists the backups and puts one back (keeping the library it replaces as a backup), and starts over with the demo library.

> **Note:** If several operator consoles edit the library at the same time, the last save wins.

## HTTP API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Status, server time and connected clients |
| `GET` / `PUT /api/library` | Read / replace the library (`{library}`) |
| `PATCH /api/library` | Save what changed since revision `base`: `{base, changes}`, with `changes` holding `presentations` and `services` as `{put, remove, order}` and other fields as `set` / `unset`. A presentation or service changed elsewhere since `base` is left alone and listed in the answer's `conflicts` |
| `GET /api/backups` | The library's backups, newest first (`{backups: [{name, time, size}]}`) |
| `POST /api/backups` | Put a backup back: `{restore: "<name>"}`. The current library is backed up first |
| `GET /api/search?q=<words>` | Song search, best match first (`{results: [{id, name, snippet}]}`); in `snippet`, the matching words are between `\u0002` and `\u0003` |
| `GET` / `POST /api/live` | Read / set the live state (`{live}`) |
| `POST /api/remote` | A command for the open console, from the phone remote or Companion: `{action: "next"}`, `"prev"`, `"nextItem"`, `"prevItem"` or `"auto"`; `{action: "item", item}` (place in the playlist, from 0); `{action: "slide", idx}` (slide of the live presentation, from 0); `{action: "go", presId, idx}`; `{action: "clear", what: "all"/"slide"/"bg"/"msg"/"logo"}`; `{action: "video", what: "toggle"/"restart"}`; `{action: "timer", what: "start"/"pause"/"reset"}`. 409 when no console is open |
| `GET` / `POST /api/control` | OSC (`{osc: {on, port, lan}}`), and what Companion connects with; changes and the details only on the local computer |
| `POST /api/media` | Upload an image or video (raw body, `X-Filename` header) |
| `DELETE /api/media/<file>` | Remove an uploaded file |
| `POST /api/slides` | Convert a PowerPoint, Impress or PDF file (raw body, `X-Filename` header) into one picture per slide (`{name, slides: ['media/<file>.png', ...], via}`) |
| `GET` / `POST /api/network` | Network mode (`{network}`, `{regenerate: true}` for a new token, `{disconnect: <device id> or "all"}`); local computer only |
| `POST /api/logout` | Sign this device out |
| `GET /api/folders` | Media folders and the pictures and videos in each (`{folders: [{id, name, files}]}`); each folder's path only on the local computer |
| `POST /api/folders` | Add a media folder (`{add: <path>}`) or remove one (`{remove: <id>}`); local computer only |
| `GET /folders/<id>/<path>` | A picture or video in a media folder |
| `GET /api/bibles` | The translations (`{bibles: [{id, name, abbrev, language, rights, bundled}]}`) |
| `POST /api/bibles` | Import a Zefania, OSIS or USFX Bible (raw XML or gzip body, `X-Filename` header) |
| `DELETE /api/bibles/<id>` | Remove an imported translation |
| `GET /api/scripture?bible=<id>&q=<text>` | The passage a reference names (`{type: "passage", reference, verses}`), or verses with those words (`{type: "search", verses}`) |
| `GET /api/events` | Server-Sent Events: `hello`, `state`, `library`, `folders`, `bibles`, `ping`. Add `?client=companion` for a controller following along, so it is never taken for a console |

### Authentication and security

- **Tokens.** Requests that change data need the token (`X-Lumen-Token`, `Authorization: Bearer`, or the sign-in cookie a token link sets) in network mode, or whenever `--token` is set. In network mode, requests from other devices also need it to read, except `/api/health`.
- **DNS rebinding.** Requests on the computer running Lumen are only accepted under an IP address, `localhost`, the computer's own name or an `--allowed-host` name, so a web page on another site can't point its own name at this computer to reach Lumen.
- **Cross-site requests.** Requests that change data must come from Lumen's own pages: JSON bodies must be sent as `application/json`, and requests a browser marks as coming from another site (`Sec-Fetch-Site`) are refused.
