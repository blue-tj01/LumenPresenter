# Lumen Presenter

**A presentation app for worship services and live events, inspired by tools like ProPresenter.**

Lumen runs as a desktop app on the presentation computer, or as a small Node server with no dependencies. Run the operator console on one computer and open the audience output and stage display on any screen on your network, in the app or in any browser.

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Pages](#pages)
- [Writing slides](#writing-slides)
- [Images and videos](#images-and-videos)
- [Themes](#themes)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Network mode](#network-mode)
- [Configuration](#configuration)
- [Data and backups](#data-and-backups)
- [HTTP API](#http-api)
- [Development](#development)
- [License](#license)

## Features

- **Library and playlist.** Build presentations, queue them in a playlist, and step through them with one key.
- **Plain-text slide editor.** Groups, colour-coded sections and a custom **play order**, so a chorus is written once and sung as often as needed.
- **Images and slideshows.** Drop in photos to make picture slides or a whole slideshow in a few clicks.
- **Videos.** Add videos to the playlist or to any slide, with synchronised playback across every output window.
- **Auto-advance and looping.** Let a presentation run by itself, ideal for announcement loops.
- **Saved themes.** One look for every song, or a dedicated theme per presentation.
- **Stage display.** Clock, countdown, current and next slide, and stage-only messages.
- **NDI output.** Send the audience output to a vision mixer, streaming software or another computer over the network, without OBS in between.
- **Network mode.** Drive screens on other devices through one-time token links, with device sign-in and sign-out.
- **Never loses the show.** Library, media and live state are saved on disk, so reloading a window or restarting the server never blanks the projector.

## Quick start

### Install

Download the latest release from the [Releases page](https://github.com/blue-tj01/LumenPresenter/releases):

| System | Download |
| --- | --- |
| Windows (64-bit) | `Lumen-Presenter-Setup-<version>.exe`, an installer with Start menu and desktop shortcuts |
| Linux (64-bit) | `Lumen-Presenter-<version>-x86_64.AppImage` to run without installing (make it executable first), or `Lumen-Presenter-<version>-amd64.deb` for Debian and Ubuntu |

The installers aren't code-signed yet, so Windows may show **Windows protected your PC** the first time: choose **More info**, then **Run anyway**.

**Updates.** The Windows app and the AppImage check for a new version when they start and every few hours after. An update downloads in the background and installs the next time Lumen is closed, so it never restarts in the middle of a service; **Help → Restart to Install** installs it straight away. The `.deb` is updated by installing the newer `.deb`.

**Bringing your library in.** The installed app keeps its library in its own data folder (`%APPDATA%\lumen-presenter\data` on Windows, `~/.config/lumen-presenter/data` on Linux). To carry over a library from a copy of the source or from `server.js`, use **File → Import Library From Folder…** and choose that copy's `data` folder. Presentations, media, the network token and signed-in devices all come across, and the library the app had is kept in its backups folder. **File → Open Data Folder** shows where it lives.

### Desktop app from the source

Requires [Node.js](https://nodejs.org) 24 or later (the current long-term support release).

```bash
npm install
npm start
```

Run this way, Lumen uses the `data` folder next to `server.js`, and doesn't update itself: pull the new code with git instead.

### Using the app

The operator console opens in its own window, and **Audience Output** and **Stage Display** open further windows. Output windows play a video's sound straight away, without first being clicked. Only one copy of the app runs at a time; starting it again brings the console to the front.

The **Screens** menu, also on the Lumen icon in the taskbar's notification area, sets the app up for a service:

- **Audience output** and **Stage display**: choose a display for each, and it opens full screen there, with no window frame and above notifications. The choice is remembered, so both come straight back up the next time Lumen starts. If a display is unplugged its screen closes rather than landing on the operator's screen, and it reopens when the display is reconnected. **In a window** goes back to an ordinary window.
- **NDI Output** sends the audience output over the network as an NDI source. See [NDI output](#ndi-output).
- **Identify Screens** shows each display's number on it for a few seconds.
- **Keep Screens Awake** (on by default) stops the computer and its displays going to sleep while Lumen runs.
- **Start Lumen When Windows Starts** opens Lumen when you sign in to Windows. Not yet available on Linux.

Closing the console while a screen is showing or NDI is sending keeps Lumen running, so the output isn't blanked by mistake. Click the Lumen icon to bring the console back, or right-click it and choose **Quit Lumen**. With no screens showing, closing the console quits Lumen.

### NDI output

The desktop app can send the audience output over the network as an [NDI®](https://ndi.video) source, which vMix, Wirecast, OBS, NDI Studio Monitor and other NDI receivers pick up directly. It sends exactly what the audience output shows, at a steady frame rate, whether or not an output window is open.

1. Install the free [NDI Tools](https://ndi.video/tools/) on the computer running Lumen, which installs the NDI Runtime Lumen uses. If Lumen was open while you installed it, choose **Screens → NDI Output → Look for NDI Again**.
2. Turn on **Screens → NDI Output → Send Audience Output over NDI**. The source appears on the network as *COMPUTER-NAME (Lumen Presenter)*. The same menu shows how many receivers are watching.
3. Choose the size (720p, 1080p or 4K) and frame rate (25, 30, 50 or 60) in the same menu. 1080p at 30 is the default. Higher settings use more processor time and network bandwidth.

NDI carries the picture only. Video sound plays from the computer running Lumen, as it does now. NDI stays on, and comes back on the next time Lumen starts, until it's turned off. The first time, Windows may ask whether Lumen can use the network: allow it on private networks so receivers can find the source.

On Linux, install the NDI SDK for Linux (which includes `libndi.so.6`) or set `NDI_RUNTIME_DIR_V6` to the folder holding it.

These choices belong to the computer, not the library, so they are kept in Lumen's own settings folder (`%APPDATA%\lumen-presenter\desktop.json` on Windows, `~/.config/lumen-presenter/desktop.json` on Linux) rather than in the data folder.

### Server only

For a headless or Linux machine, or to use your own browser, run the server on its own:

```bash
node server.js
```

Open <http://localhost:8642> for the operator console. The server pushes every change to all open windows instantly over Server-Sent Events.

After updating the app's files, restart the app or `server.js`. Until you do, the old server keeps running and the console tells you so.

### Moving from `server.py`

Earlier versions ran on a Python server. The Node server reads and writes the same data folder in the same format, so the library, media, network setting, token and signed-in devices all carry over. Stop `server.py` before starting Lumen, as both use port 8642.

## Pages

| Page | Purpose |
| --- | --- |
| `index.html` | **Operator console:** library, playlist, slide grid, live preview, media bin, themes, messages and timer |
| `output.html` | **Audience output:** open it on the projector and double-click (or press <kbd>F</kbd>) for full screen |
| `stage.html` | **Stage display:** clock, countdown, current and next slide, and stage-only messages |

With the server running, any of these pages can be opened on any device that can reach it.

## Writing slides

Slides are written as plain text in the editor:

```text
@bg: linear-gradient(135deg,#1e3c72,#2a5298)
[Verse 1]
First line
Second line

Next slide in the same group

[Chorus]
Chorus line
```

| Syntax | Effect |
| --- | --- |
| `[Name]` | Starts a group. Verse, Chorus, Bridge, Pre-Chorus, Tag, Intro and Ending are colour-coded. |
| Blank line | Starts a new slide. |
| `@bg:` | Sets the presentation's default background: a colour, CSS gradient, or image or video URL. |
| `@image:` | Shows a picture on that slide, letterboxed over the background. Other lines on the slide appear as text on top. |
| `@video:` | Plays a video on that slide, once, with sound on the audience output. |

### Play order

Write each group once, then set the order it is sung in the editor's **Play order** box, for example `Verse 1, Chorus, Verse 2, Chorus, Bridge`. Clicking a group's button below the box adds it to the end. Groups can repeat, and both the slide grid and Next/Previous follow the order. Leave the box empty to play the groups as written.

### Auto-advance

Set **Auto-advance every … seconds** in the editor to have a presentation move to the next slide by itself. After the last slide it loops back to the first, rather than moving on to the next playlist item. A video slide moves on when its video ends.

Clicking a slide or pressing Next/Previous restarts the count from there. The **❚❚ Auto** button under Prev / Next shows the time left and pauses or resumes it. Leave the box empty to advance by hand.

## Images and videos

### Slideshows and picture slides

In the editor, **🖼 Add images** (or dropping pictures onto the text) uploads them and adds one `@image:` slide per picture at the cursor. In a new presentation it replaces the sample text with a `[Slideshow]` group, so making a slideshow is: **＋** → **Add images** → pick the photos → **Save**.

```text
[Slideshow]
@image: media/3f9c2a7b1e4d5a60.jpg

@image: media/8a1b2c3d4e5f6071.jpg
Welcome to Youth Camp!
```

### Videos in the playlist

**＋ Video** in the playlist header (or dropping video files onto the playlist) adds each video to the queue as its own item, marked ▶. A video already in the media bin has a **＋ Playlist** button. Each one is a one-slide presentation, so it plays in turn and **Next** moves on to the following item.

A live video plays once, with sound on the audience output only (the console preview and thumbnails are muted), then fades to black. While it plays, **Pause / Play** and **Restart** appear under Prev / Next with the elapsed time. Every output window follows the same clock, so a window opened or reloaded mid-video joins at the right moment.

Any slide can carry a video with an `@video:` line, and the editor's **Add images / videos** button accepts both. If the browser blocks sound in the output window until it has been clicked, the video starts silently and the window asks to be clicked once.

### Media folders

Instead of uploading, Lumen can play pictures and videos straight from a folder on the computer running it, such as a shared folder of worship loops. Nothing is copied, so a file added to the folder shows up in Lumen straight away, and a large video doesn't need uploading first.

- **Adding a folder.** In the desktop app, use **＋ Folder** above the media bin or **File → Add Media Folder…**. In a browser on the computer running Lumen, **＋ Folder** asks for the folder's full path. Folders can be added and removed only on that computer.
- **Using it.** The list next to **Media** switches between the media bin and each folder. A folder shows every picture and video in it and its subfolders, with a search box. Click one to make it the background, or use **＋ Playlist** on a video. Folder files are shown on other devices' screens too, served by Lumen.
- **Slides.** A slide can use a folder file with `@image:` or `@video:` and the path the media bin gives it, for example `@video: folders/3f9c2a7b1e4d/Easter/Sunrise.mp4`.
- **Removing a folder.** **Remove folder** stops Lumen showing it and leaves the files where they are. If a folder is renamed, moved or on a drive that's unplugged, it is marked **not found** and its slides go blank until it's back.

Lumen serves only pictures and videos from inside each folder. Other files, other folders and links out of the folder aren't reachable.

## Themes

The **Theme** tab has two lists:

- **All songs** picks the theme every presentation uses: Classic, Lower third, Scripture, Big & bold, one of your own, or the plain default. Switching songs keeps the same look with nothing to restyle.
- **This song** gives the selected presentation its own theme, which it keeps every time it goes live.

The font, size, colour and alignment controls edit the theme the selected song is shown with, and every song using that theme follows. **Save as…** stores the current settings as a new theme. The editor offers the same theme list, so a new presentation (for example a Scripture reading) can be given its theme when it is created.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| <kbd>→</kbd> <kbd>↓</kbd> <kbd>Space</kbd> <kbd>PgDn</kbd> | Next slide (continues into the next playlist item) |
| <kbd>←</kbd> <kbd>↑</kbd> <kbd>PgUp</kbd> | Previous slide |
| <kbd>F1</kbd> | Clear all |
| <kbd>F2</kbd> | Clear slide text |
| <kbd>F3</kbd> | Clear background media |
| <kbd>F4</kbd> | Clear message |
| <kbd>F6</kbd> | Toggle logo screen |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>S</kbd> | Save, in the editor |
| <kbd>Esc</kbd> | Close the editor |

## Network mode

Lumen starts local-only. To drive screens from other machines (a stage display on a laptop, the output on a second computer, a second operator console), open the console's **Network** tab and turn on **Network mode**. The change takes effect immediately, with no restart.

**Token links.** The Network tab shows a link for the operator console, the audience output and the stage display, each carrying the access token. Opening a link once signs that device in with a cookie that stands for the device rather than the token, and the token is removed from the address bar.

**Access.** In network mode other devices need the token to see anything, not just to change it; a device that opens Lumen without a link is asked for it. The computer running Lumen never is. The network setting and token can only be viewed or changed on that computer.

**Devices.** The Network tab lists signed-in devices and what each is showing. **Disconnect** (or **Disconnect all**) signs a device out and returns it to the token page. A console on another device has **Sign out of this device** in its own Network tab.

**Rotating the token.** Anyone who knows the token can sign back in, so **New** generates a fresh token and signs every device out until it is given the new one.

The token is generated the first time the server starts and is saved, along with the network setting, in `settings.json` in the data directory. Updating or replacing the app's files leaves it untouched, so both survive upgrades and restarts.

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

### Running as a service

A systemd unit is provided in [`deploy/lumen.service`](deploy/lumen.service).

### Behind a reverse proxy

- Pass `--token`, because requests relayed by a proxy on the same computer otherwise look local.
- Pass `--allowed-host` with the name the proxy serves Lumen under, if the proxy forwards that name (Caddy does; nginx only with `proxy_set_header Host`).
- Turn off response buffering for `/api/events` (nginx: `proxy_buffering off;`).
- Raise the request body limit if you upload videos.

### Without the server

The pages also work from any static host (for example `npx http-server`). In that mode the library is kept in the browser's `localStorage`, pictures are kept in the media bin and referenced as `@image: #<id>`, videos last for the current session only, and all windows must be on the same computer. The console's status indicator shows **Local only**.

## Data and backups

With the app or the server, everything lives in the data directory. For the installed app that is its own data folder (see [Install](#install)); for `server.js` and the app run from the source it is the `data` folder next to `server.js`. `--data` or `LUMEN_DATA` overrides either.

| Path | Contents |
| --- | --- |
| `lumen.db` | The library: presentations, playlist, media list, themes and messages, in an SQLite database (with `lumen.db-wal` and `lumen.db-shm` beside it while Lumen is running) |
| `live.json` | What is on screen right now, so windows recover after a restart |
| `settings.json` | Network mode, the access token, signed-in devices and media folders (readable only by the account running the server) |
| `media/` | Uploaded images and videos |
| `backups/` | Snapshots of the library as JSON, at most one every 10 minutes, newest 50 kept |

Back up the data directory to back up everything (with Lumen closed, so the database is in one file).

Earlier versions kept the library in `library.json`. When Lumen starts and finds one there, it moves it into the database and keeps the file in `backups/before-database-<time>/`, so copying an old `library.json` into the data directory is still a way to restore it. **Export** / **Import** in the console produce and read a portable JSON library.

> **Note:** If several operator consoles edit the library at the same time, the last save wins.

## HTTP API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Status, server time and connected clients |
| `GET` / `PUT /api/library` | Read / replace the library (`{library}`) |
| `GET` / `POST /api/live` | Read / set the live state (`{live}`) |
| `POST /api/media` | Upload an image or video (raw body, `X-Filename` header) |
| `DELETE /api/media/<file>` | Remove an uploaded file |
| `GET` / `POST /api/network` | Network mode (`{network}`, `{regenerate: true}` for a new token, `{disconnect: <device id> or "all"}`); local computer only |
| `POST /api/logout` | Sign this device out |
| `GET /api/folders` | Media folders and the pictures and videos in each (`{folders: [{id, name, files}]}`); each folder's path only on the local computer |
| `POST /api/folders` | Add a media folder (`{add: <path>}`) or remove one (`{remove: <id>}`); local computer only |
| `GET /folders/<id>/<path>` | A picture or video in a media folder |
| `GET /api/events` | Server-Sent Events: `hello`, `state`, `library`, `folders`, `ping` |

### Authentication and security

- **Tokens.** Requests that change data need the token (`X-Lumen-Token`, `Authorization: Bearer`, or the sign-in cookie a token link sets) in network mode, or whenever `--token` is set. In network mode, requests from other devices also need it to read, except `/api/health`.
- **DNS rebinding.** Requests on the computer running Lumen are only accepted under an IP address, `localhost`, the computer's own name or an `--allowed-host` name, so a web page on another site can't point its own name at this computer to reach Lumen.
- **Cross-site requests.** Requests that change data must come from Lumen's own pages: JSON bodies must be sent as `application/json`, and requests a browser marks as coming from another site (`Sec-Fetch-Site`) are refused.

## Development

There is no build step: edit the HTML, CSS and JavaScript files and reload. The console's scripts are ES modules, loaded by the browser as they are.

| File | Contents |
| --- | --- |
| `server.js` | Starts the server, using Node's standard library only |
| `server/lumen-server.js`, `server/request.js` | Listening, network mode, and handling each request: sign-in, checks and files |
| `server/api/` | The HTTP API, one file per area (library and live state, media and folders, network, events) |
| `server/store.js`, `server/library.js` | Settings, live state and backups, and the library's SQLite database |
| `server/folders.js`, `server/hub.js`, `server/media.js` | Media folders, live updates to open pages, and media file types |
| `electron/main.js` | The desktop app: starts the server in-process, opens the console window, and sets up the menus and tray icon |
| `electron/screens.js` | The desktop app's full-screen output and stage windows, and which display each goes on |
| `electron/ndi.js`, `electron/ndi-lib.js` | Sending the audience output over NDI, and the calls into the NDI Runtime |
| `electron/updates.js`, `electron/data.js` | Updates for the installed app, and importing a library from another data folder |
| `electron/preload.js` | The desktop app's folder picker, offered to the console |
| `.github/workflows/build.yml` | Tests, installers and releases on GitHub Actions |
| `index.html`, `app.css`, `console/` | The operator console; `console/main.js` loads the library and wires up the page, and each other file is one part of it (views, editor, media, themes, timer, network) |
| `console/format.js` | The slide format: presentations, templates and layouts of positioned elements, converting libraries saved by earlier versions, and resolving a slide into what a screen draws |
| `output.html`, `stage.html`, `render.js`, `render.css` | The audience output and stage display |
| `sync.js` | The pages' link to the server |

Run the tests with:

```bash
npm test
```

The NDI tests use a stand-in for NDI. To also send real frames, set `LUMEN_NDI_LIB` to the NDI library (for example `libndi.so.6`, or `Processing.NDI.Lib.x64.dll` in the NDI Runtime folder on Windows) before running them.

GitHub Actions runs the tests on Windows and Linux for every pull request. Each push to `main` also builds the installers, which can be downloaded from the run's **Artifacts**. `npm run dist` builds them locally, into `dist/`.

### Releasing

1. Set the new version: `npm version minor` (or `patch`), which updates `package.json` and makes a `v<version>` tag.
2. Push it: `git push --follow-tags`.

The tag's build publishes the Windows and Linux installers as a GitHub release, and installed copies update from it. Updates need the repository to be public, since installed copies download releases without signing in.

### macOS

Not built yet. Lumen runs on a Mac from the source, but a downloadable Mac app needs an Apple Developer account (about $99 a year) to sign and notarise it, or macOS refuses to open it and it can't update itself. Adding it later is a `mac` target in `package.json` and a macOS runner in the workflow.

## License

Lumen Presenter is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. See [`LICENSE`](LICENSE) for the full text.

It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.

NDI® is a registered trademark of Vizrt NDI AB.
