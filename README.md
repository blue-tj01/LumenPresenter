# Lumen Presenter

A browser-based worship / live presentation app, built from scratch and inspired by tools like ProPresenter. No build step, no dependencies.

## Run it

```bash
python3 server.py
```

Then open http://localhost:8642. Python 3.8+ is the only requirement.

The server keeps the library, media and live state on disk and pushes every change to all open windows, on any device. Reloading the console, closing the browser, or restarting the server never loses the library or blanks the projector.

To drive screens from other machines (stage display on a laptop, output on a second computer, a second operator console), bind to the network and set a token:

```bash
python3 server.py --host 0.0.0.0 --token <secret>
```

The console asks for the token the first time it changes anything. Output and stage pages only read, so they don't need it.

| Option | Env var | Default |
| --- | --- | --- |
| `--host` | `LUMEN_HOST` | `127.0.0.1` |
| `--port` | `LUMEN_PORT` | `8642` |
| `--data` | `LUMEN_DATA` | `./data` |
| `--token` | `LUMEN_TOKEN` | none (no auth) |
| `--max-upload-mb` | `LUMEN_MAX_UPLOAD_MB` | `4096` |

To run it as a service, see `deploy/lumen.service` (systemd). Behind a reverse proxy, turn off response buffering for `/api/events` (nginx: `proxy_buffering off;`), and raise the request body limit if you upload videos.

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

## Data

With the server, everything lives in the data directory:

| Path | Contents |
| --- | --- |
| `library.json` | Presentations, playlist, media list, theme, messages (written atomically) |
| `live.json` | What is on screen right now, so windows recover after a restart |
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
| `GET /api/events` | Server-Sent Events: `hello`, `state`, `library`, `ping` |

Requests that change data need `X-Lumen-Token` or `Authorization: Bearer` when a token is set.

## Tests

```bash
python3 -m unittest discover tests
```
