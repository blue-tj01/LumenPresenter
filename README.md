# Lumen Presenter

A browser-based worship / live presentation app, built from scratch and inspired by tools like ProPresenter. No build step, no dependencies.

## Run it

```bash
python3 server.py
```

Then open http://localhost:8642. Python 3.8+ is the only requirement.

The server keeps the library, media and live state on disk and pushes every change to all open windows, on any device. Reloading the console, closing the browser, or restarting the server never loses the library or blanks the projector.

To drive screens from other machines (stage display on a laptop, output on a second computer, a second operator console), open the console's **Network** tab and turn on **Network mode**. It shows the address to open on the other devices and the access token. Lumen starts local-only, and turning network mode on or off takes effect straight away, with no restart.

The token is generated the first time the server starts and saved, with the network setting, in `settings.json` in the data directory. Updating or replacing the app's files leaves it alone, so the token and the setting survive upgrades and restarts. **New** in the Network tab makes a fresh token if the old one has been shared too widely. The network setting and token can only be seen or changed on the computer running Lumen.

Other consoles ask for the token the first time they change anything. The console on the computer running Lumen is given it automatically, and output and stage pages only read, so they don't need it.

The command-line options still work, and take precedence over the console: `--host` fixes the address (the Network switch is then shown but can't be changed), and `--token` replaces the saved token and is required even locally.

| Option | Env var | Default |
| --- | --- | --- |
| `--host` | `LUMEN_HOST` | `127.0.0.1`, or `0.0.0.0` once network mode is on |
| `--port` | `LUMEN_PORT` | `8642` |
| `--data` | `LUMEN_DATA` | `./data` |
| `--token` | `LUMEN_TOKEN` | the generated one, required in network mode |
| `--max-upload-mb` | `LUMEN_MAX_UPLOAD_MB` | `4096` |

To run it as a service, see `deploy/lumen.service` (systemd). Behind a reverse proxy, pass `--token` (requests relayed by a proxy on the same computer otherwise look local), turn off response buffering for `/api/events` (nginx: `proxy_buffering off;`), and raise the request body limit if you upload videos.

### Without the server

The pages still work from any static host (`python -m http.server`). In that mode the library is kept in the browser's `localStorage`, videos last for the current session only, and the windows must be on the same computer. The console's status indicator shows **Local only**.

## Pages

| Page | Purpose |
| --- | --- |
| `index.html` | Operator console: library, playlist, slide grid, live preview, media bin, theme, messages, timer |
| `output.html` | Audience output — open on the projector and double-click (or press F) for full screen |
| `stage.html` | Stage display — clock, countdown, current and next slide, stage-only messages |

With the server, any of these can be opened on any device that can reach it. Changes are pushed over Server-Sent Events.

## Keyboard

| Key | Action |
| --- | --- |
| → / ↓ / Space / PgDn | Next slide (continues into the next playlist item) |
| ← / ↑ / PgUp | Previous slide |
| F1 | Clear all |
| F2 | Clear slide text |
| F3 | Clear background media |
| F4 | Clear message |
| F6 | Toggle logo screen |

## Writing slides

```
@bg: linear-gradient(135deg,#1e3c72,#2a5298)
[Verse 1]
First line
Second line

Next slide in the same group

[Chorus]
Chorus line
```

- `[Name]` starts a group; Verse, Chorus, Bridge, Pre-Chorus, Tag, Intro and Ending are colour-coded.
- A blank line starts a new slide.
- An optional `@bg:` line sets the presentation's default background (colour, CSS gradient, image or video URL).
- An `@image:` line puts a picture on that slide, letterboxed over the background. Any other lines on the slide are shown as text on top of it.
- An `@video:` line plays a video on that slide, once, with sound on the audience output.

### Play order

Write each group once, then set the order it is sung in the editor's **Play order** box, for example `Verse 1, Chorus, Verse 2, Chorus, Bridge`. Clicking a group's button under the box adds it to the end. Groups can repeat, the slide grid and Next/Previous follow the order, and an empty box plays the groups as written.

### Auto-advance

Set **Auto-advance every … seconds** in the editor to have a presentation move to the next slide by itself. After the last slide in its play order it goes back to the first and keeps looping, rather than moving on to the next playlist item. A video slide in such a presentation moves on when the video ends. Clicking a slide or pressing Next/Previous restarts the count from there, and the **❚❚ Auto** button under Prev / Next (with the time left) pauses and resumes it. Leave the box empty to advance by hand.

### Slideshows and picture slides

In the editor, **🖼 Add images** (or dropping pictures onto the text) uploads them and adds one `@image:` slide per picture where the cursor is. In a new presentation it replaces the sample text with a `[Slideshow]` group, so a slideshow is: **＋** → **Add images** → pick the photos → **Save**.

```
[Slideshow]
@image: media/3f9c2a7b1e4d5a60.jpg

@image: media/8a1b2c3d4e5f6071.jpg
Welcome to Youth Camp!
```

Without the server, pictures are kept in the media bin and referenced as `@image: #<id>`.

### Videos in the playlist

**＋ Video** in the playlist header (or dropping video files onto the playlist) adds each video to the queue as its own item, marked ▶. A video already in the media bin has a **＋ Playlist** button. Each one is a one-slide presentation, so it plays in turn and **Next** moves on to the following song.

A live video plays once, with sound on the audience output only (the console preview and thumbnails are muted), then fades to black. While it is live, **Pause / Play** and **Restart** appear under Prev / Next with the elapsed time. Every output window follows the same clock, so a window opened or reloaded mid-video joins at the right moment.

Any slide can carry a video with an `@video:` line, the same way as `@image:`, and the editor's **Add images / videos** button accepts both. If the browser blocks sound in the output window until it has been clicked, the video starts silently and the window says to click it once.

Without the server, videos last for the current session only.

## Themes

The **Theme** tab has two lists. **All songs** picks the theme every presentation uses (Classic, Lower third, Scripture, Big & bold, your own, or the plain default style), so switching songs keeps the same look with nothing to restyle. **This song** gives the selected presentation its own theme instead, which it keeps every time it goes live. The font, size, colour and alignment controls edit the theme the selected song is shown with, and every song using that theme follows. **Save as…** stores the current settings as a new theme. The editor has the same theme list, so a new presentation can be given its theme (for example Scripture for readings) when it is created.

## Data

With the server, everything lives in the data directory:

| Path | Contents |
| --- | --- |
| `library.json` | Presentations, playlist, media list, themes, messages (written atomically) |
| `live.json` | What is on screen right now, so windows recover after a restart |
| `settings.json` | Network mode and its access token (readable only by the account running the server) |
| `media/` | Uploaded images and videos |
| `backups/` | Snapshots of `library.json`, at most one every 10 minutes, newest 50 kept |

Back up the data directory to back up everything. **Export** / **Import** still produce a portable JSON library.

If several operator consoles edit the library at the same time, the last save wins.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Status, server time, connected clients |
| `GET` / `PUT /api/library` | Read / replace the library (`{library}`) |
| `GET` / `POST /api/live` | Read / set the live state (`{live}`) |
| `POST /api/media` | Upload an image or video (raw body, `X-Filename` header) |
| `DELETE /api/media/<file>` | Remove an uploaded file |
| `GET` / `POST /api/network` | Network mode (`{network}`, or `{regenerate: true}` for a new token); the token and changes are only for the computer running Lumen |
| `GET /api/events` | Server-Sent Events: `hello`, `state`, `library`, `ping` |

Requests that change data need `X-Lumen-Token` or `Authorization: Bearer` in network mode, or whenever `--token` is set.

## Tests

```bash
python3 -m unittest discover tests
```
