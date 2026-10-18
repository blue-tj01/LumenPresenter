# Lumen Presenter

A browser-based worship / live presentation app, built from scratch and inspired by tools like ProPresenter. No build step, no dependencies.

## Run it

```bash
python -m http.server 8642
```

Then open http://localhost:8642.

## Pages

| Page | Purpose |
| --- | --- |
| `index.html` | Operator console: library, playlist, slide grid, live preview, media bin, theme, messages, timer |
| `output.html` | Audience output — open on the projector and double-click (or press F) for full screen |
| `stage.html` | Stage display — clock, countdown, current and next slide, stage-only messages |

The windows stay in sync over a `BroadcastChannel`, so they must be opened from the same origin.

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

## Data

The library is saved in the browser's `localStorage`. Use **Export** / **Import** to back it up as JSON. Dropped-in videos last for the current session only.
