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

## Features

- **Library and playlist.** Build presentations, queue them in a playlist, and step through them with one key.
- **Plain-text slide editor.** Groups, colour-coded sections and a custom **play order**, so a chorus is written once and sung as often as needed.
- **Images and slideshows.** Drop in photos to make picture slides or a whole slideshow in a few clicks.
- **Videos.** Add videos to the playlist or to any slide, with synchronised playback across every output window.
- **Auto-advance and looping.** Let a presentation run by itself, ideal for announcement loops.
- **Saved themes.** One look for every song, or a dedicated theme per presentation.
- **Stage display.** Clock, countdown, current and next slide, and stage-only messages.
- **Network mode.** Drive screens on other devices through one-time token links, with device sign-in and sign-out.
- **Never loses the show.** Library, media and live state are saved on disk, so reloading a window or restarting the server never blanks the projector.

## Quick start

Requires [Node.js](https://nodejs.org) 20 or later.

### Desktop app

```bash
npm install
npm start
```

The operator console opens in its own window, and **Audience Output** and **Stage Display** open further windows. Output windows play a video's sound straight away, without first being clicked. Only one copy of the app runs at a time; starting it again brings the console to the front, and closing the console closes the app.

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

With the app or the server, everything lives in the data directory. That is the `data` folder next to `server.js`, unless `--data` or `LUMEN_DATA` says otherwise.

| Path | Contents |
| --- | --- |
| `library.json` | Presentations, playlist, media list, themes and messages (written atomically) |
| `live.json` | What is on screen right now, so windows recover after a restart |
| `settings.json` | Network mode, the access token and signed-in devices (readable only by the account running the server) |
| `media/` | Uploaded images and videos |
| `backups/` | Snapshots of `library.json`, at most one every 10 minutes, newest 50 kept |

Back up the data directory to back up everything. **Export** / **Import** in the console produce and read a portable JSON library.

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
| `GET /api/events` | Server-Sent Events: `hello`, `state`, `library`, `ping` |

### Authentication and security

- **Tokens.** Requests that change data need the token (`X-Lumen-Token`, `Authorization: Bearer`, or the sign-in cookie a token link sets) in network mode, or whenever `--token` is set. In network mode, requests from other devices also need it to read, except `/api/health`.
- **DNS rebinding.** Requests on the computer running Lumen are only accepted under an IP address, `localhost`, the computer's own name or an `--allowed-host` name, so a web page on another site can't point its own name at this computer to reach Lumen.
- **Cross-site requests.** Requests that change data must come from Lumen's own pages: JSON bodies must be sent as `application/json`, and requests a browser marks as coming from another site (`Sec-Fetch-Site`) are refused.

## Development

There is no build step: edit the HTML, CSS and JavaScript files and reload.

| File | Contents |
| --- | --- |
| `server.js` | The server: storage, the HTTP API, live updates and network mode. Node's standard library only. |
| `electron/main.js` | The desktop app: starts the server in-process and opens the console window. |
| `index.html`, `app.js`, `app.css` | The operator console |
| `output.html`, `stage.html`, `render.js`, `render.css` | The audience output and stage display |
| `sync.js` | The pages' link to the server |

Run the tests with:

```bash
npm test
```
