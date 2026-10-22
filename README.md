# Lumen Presenter

**A presentation app for worship services and live events, inspired by tools like ProPresenter.**

Lumen runs as a desktop app on the presentation computer, or as a small Node server with no dependencies. Run the operator console on one computer and open the audience output and stage display on any screen on your network, in the app or in any browser.

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Pages](#pages)
- [Writing slides](#writing-slides)
- [Scripture](#scripture)
- [Images and videos](#images-and-videos)
- [Song search and CCLI](#song-search-and-ccli)
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
- **Services.** Keep a dated playlist for each service, and copy last week's to start the next one.
- **Plain-text slide editor.** Groups, colour-coded sections and a custom **play order**, so a chorus is written once and sung as often as needed.
- **Scripture.** Find a passage by reference or by its words in the KJV, WEB or BSB, or in a Bible you import, and put it on slides in one click.
- **Images and slideshows.** Drop in photos to make picture slides or a whole slideshow in a few clicks.
- **PowerPoint slides.** Import a PowerPoint, Impress or PDF file, such as the week's sermon slides, and step through it like any other presentation, exactly as it was designed.
- **Videos.** Add videos to the playlist or to any slide, with synchronised playback across every output window.
- **Auto-advance and looping.** Let a presentation run by itself, ideal for announcement loops.
- **Song search.** Find a song by any words in it, its title, its writers or its CCLI song number, as you type.
- **CCLI details.** Each song keeps its writers, copyright and CCLI song number, shown with your church's CCLI licence number on its last slide.
- **CCLI usage report.** Lumen notes each song shown in a service, and lists them by date range to copy into CCLI's reporting page or save as a CSV file.
- **Song import.** Bring in songs downloaded from CCLI SongSelect (`.usr` or `.txt`), or a library from OpenLP (OpenLyrics) or OpenSong, words, play order and CCLI details included.
- **Transitions.** Cut, fade, dip to black, push or zoom between slides, for every song or one presentation, the same on every screen and over NDI.
- **Saved themes.** One look for every song, or a dedicated theme per presentation.
- **Stage display.** Clock, countdown, current and next slide, and stage-only messages.
- **NDI output.** Send the audience output to a vision mixer, streaming software or another computer over the network, without OBS in between.
- **Phone remote.** Step through the service from a phone: next and previous, the playlist and its slides, and clearing the screen.
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

**Ubuntu 24.04 and later.** If `npm start` stops with *The SUID sandbox helper binary was found, but is not configured correctly*, AppArmor is stopping Electron from setting up its sandbox. Allow it once, from the project folder:

```bash
sudo tee /etc/apparmor.d/lumen-electron >/dev/null <<EOF
abi <abi/4.0>,
include <tunables/global>

profile lumen-electron $PWD/node_modules/electron/dist/electron flags=(unconfined) {
  userns,
  include if exists <local/lumen-electron>
}
EOF
sudo apparmor_parser -r /etc/apparmor.d/lumen-electron
```

This lasts through `npm install`, but if you move the project folder, run it again from the new folder. Don't use `--no-sandbox` to get round the error: it turns off the sandbox the app's windows rely on. The `.deb` sets this up itself when it installs. The AppImage may need the same kind of profile, pointing at the AppImage file.

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

**On Linux.** NDI Tools isn't made for Linux, so step 1 is different: download the [NDI SDK for Linux](https://ndi.video/for-developers/ndi-sdk/) and run its installer, which unpacks a `NDI SDK for Linux` folder. Lumen needs `libndi.so.6` from its `lib/x86_64-linux-gnu` folder. Either copy it to where the system finds libraries:

```bash
sudo cp -P "NDI SDK for Linux/lib/x86_64-linux-gnu/"libndi.so* /usr/local/lib/ && sudo ldconfig
```

or set `NDI_RUNTIME_DIR_V6` to that folder before starting Lumen. NDI Studio Monitor isn't made for Linux either: to watch the source on the same computer, use OBS with the DistroAV plugin, or watch from a Windows or Mac computer on the network. Receivers find the source only on the same network segment, so guest Wi-Fi or a router that keeps devices apart can hide it.

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
| `remote.html` | **Phone remote:** next and previous, what is on screen and next, the service's playlist with its slides, and clear buttons |

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

### Services

The playlist belongs to a **service**: a name and a date, such as *Sun 26 Oct 2026 · Morning service*. The list above the playlist holds every saved service, newest first, and picking one opens its playlist. The buttons beside **Service** make a new, empty service (**＋**), copy the open one to a week later (**⧉**, for building next week's from this week's), rename it or change its date (**✎**), and delete it (**✕**; its songs stay in the library). To add a song, drag it from the library onto the playlist (dropping it on an item puts it before that one), double-click it, or use **＋ Playlist** above the slides. Every console on the network shows the same open service.

A library from before services opens with its playlist as one service, dated the coming Sunday.

### Play order

Write each group once, then set the order it is sung in the editor's **Play order** box, for example `Verse 1, Chorus, Verse 2, Chorus, Bridge`. Clicking a group's button below the box adds it to the end. Groups can repeat, and both the slide grid and Next/Previous follow the order. Leave the box empty to play the groups as written.

### Auto-advance

Set **Auto-advance every … seconds** in the editor to have a presentation move to the next slide by itself. After the last slide it loops back to the first, rather than moving on to the next playlist item. A video slide moves on when its video ends.

Clicking a slide or pressing Next/Previous restarts the count from there. The **❚❚ Auto** button under Prev / Next shows the time left and pauses or resumes it. Leave the box empty to advance by hand.

## Scripture

The **Bible** tab finds passages and makes slides of them. It needs the server (the desktop app or `server.js`).

- **Translations.** The King James Version, World English Bible and Berean Standard Bible come with Lumen. All three are in the public domain. **Import…** adds another from a Zefania XML, OSIS or USFX file (gzipped is fine), the formats most free Bible downloads use. **Remove** takes an imported one out again.
- **Finding a passage.** Type a reference the way you'd write it: `John 3:16`, `Jn 3:16-18`, `1 Cor 13:4-7, 13`, `Ps 23`, `Gen 1:1-2:3`, `Jude 3`, or several at once with `;`. An imported translation's own book names work too.
- **Finding words.** Anything that isn't a reference searches the words of the translation, best matches first, with the last word matched as you type it. Put a phrase in quotes to find it exactly. Click a verse to use it.
- **Making slides.** **Go Live** puts the passage up straight away, as slides with the Scripture theme, without adding it to the library: step through it as usual, and the next passage shown replaces it. **Add to library** keeps it (the one on screen, if that's the passage) to use again later. Each slide carries its reference (for example `John 3:16 KJV`), shown small under the verse. **Verses per slide** puts more than one verse on a slide while they fit, and a verse longer than **Characters** is split across slides at the end of a sentence or clause. **Verse numbers** puts each verse's number in front of it.

The first time a slide is made from the Scripture theme, the theme gets a box for the reference. Songs shown with the Scripture theme don't change, because they carry no reference.

## Images and videos

### Slideshows and picture slides

In the editor, **🖼 Add images** (or dropping pictures onto the text) uploads them and adds one `@image:` slide per picture at the cursor. In a new presentation it replaces the sample text with a `[Slideshow]` group, so making a slideshow is: **＋** → **Add images** → pick the photos → **Save**.

```text
[Slideshow]
@image: media/3f9c2a7b1e4d5a60.jpg

@image: media/8a1b2c3d4e5f6071.jpg
Welcome to Youth Camp!
```

### PowerPoint and PDF slides

**⤓ Slides** above the library imports a PowerPoint (`.pptx`, `.ppt`, `.ppsx`, `.pps`), LibreOffice Impress (`.odp`) or PDF file as a presentation, with each slide as a picture. Dropping the file onto the library does the same, and dropping it onto the playlist also puts it in the service at that point. The presentation is named after the file and marked ▤, and plays like any other: click a slide or use Next and Previous, and Next carries on into the next playlist item after the last slide.

Each slide becomes a 1920-pixel-wide picture, on black, so it looks exactly as it was designed, with its own fonts, pictures and layout, and doesn't take on Lumen's theme. Hidden slides are left out. Animations, slide transitions, and video or sound inside a slide aren't kept; put a video on a slide of its own with `@video:` instead. To bring in a new version of a deck, import it again and delete the old one.

**PDFs need nothing installed.** The console draws each page itself with [pdf.js](https://mozilla.github.io/pdf.js/), the PDF reader in Firefox, and uploads it. So the simplest way to bring in sermon slides on any computer is to ask for them as a PDF (in PowerPoint, **File → Save As → PDF**).

PowerPoint and Impress files are made into pictures on the computer running Lumen, with what it has:

| | Used for |
| --- | --- |
| Microsoft PowerPoint (Windows) | PowerPoint files, so they look exactly as they do in PowerPoint |
| [LibreOffice](https://www.libreoffice.org) | Any of the files, when PowerPoint isn't installed or can't open one. On Linux, install its Python support too (`python3-uno` on Debian and Ubuntu), or `poppler-utils`. |

Lumen finds LibreOffice where its installer puts it; set `LUMEN_SOFFICE` to the full path of `soffice` if it is somewhere else. A deck takes a few seconds to a minute to convert, one file at a time. Lumen opens the file read-only and never runs macros in it.

If an import fails, the console keeps the error on screen until it is closed, with a **Copy** button to report it, and every import, with everything a failed converter said, is written to `slides-import.log` in the data folder.

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

## Song search and CCLI

The search box above the library finds songs by their title, any of their words, who wrote them, their copyright or their CCLI song number. Type the start of a few words in any order (`am gr sweet` finds Amazing Grace); every word has to match, accents and capitals don't matter, and the best matches come first, titles before words. Each result shows the line that matched. With the server, search uses the library database's full-text index; opened without it, the console matches the words as typed.

In the editor, **Written by**, **Copyright** and **CCLI song #** hold a song's details. A song with any of them shows its credits on its last slide, small along the bottom:

> “Amazing Grace” · John Newton
> Public Domain · CCLI Song # 22025 · CCLI Licence # 123456

Enter your church's licence number once, in **CCLI licence #** under **Song credits** on the **Theme** tab, and every song shows it. **Show credits on each song's last slide** turns them off. A presentation with no song details, such as an announcement loop, never shows credits. A theme that places the song's copyright or CCLI number itself (a text box bound to `pres.credits` or a `pres.meta` field) is shown as it is, without the credits line added.

### Importing from SongSelect

Songs downloaded from [CCLI SongSelect](https://songselect.ccli.com) come straight into the library. Click **⤓ Songs** above the library and choose one or more files, or drop them onto the library list. Both of SongSelect's lyric downloads work: the `.usr` file and the plain text (`.txt`) download.

Each song arrives with its title, its sections as groups (Verse 1, Chorus, Bridge and so on, colour-coded as usual) split into slides of two lines, and its writers, copyright and CCLI song number filled in, so its credits show on its last slide straight away. A section the download writes out more than once, such as a repeated chorus, becomes one group played in each place it comes, in the song's play order. A song already in the library, matched by its CCLI song number, is left as it is rather than added twice; delete the old one first to bring in a fresh copy.

### Moving from OpenLP or OpenSong

Songs from OpenLP and OpenSong come in the same way, through **⤓ Songs** or by dropping the files onto the library, many at a time:

- **OpenLP:** choose **File → Export → Song** and the OpenLyrics format, which saves one `.xml` file per song. Other apps that save OpenLyrics files work too.
- **OpenSong:** the songs are the files in the `Songs` folder of OpenSong's data folder (they have no extension).

Each song keeps its slides as they were, its verses as groups (`v1` becomes Verse 1, `c` Chorus, `b` Bridge, `p` Pre-Chorus and so on), its verse order as the play order, and its writers, copyright and CCLI song number. Chords and comments are left out. A song written in several languages comes in in the first one. As with SongSelect, a song already in the library is left as it is.

### CCLI usage report

Lumen keeps the record a CCLI licence asks for. Each time a song with a CCLI song number goes live, it is noted with the day and the open service, once however many of its slides are shown. Going back to it later in the same service doesn't count it again, but the same song in an evening service on the same day counts as a second use. Songs without a CCLI song number, such as notices or your own songs, aren't counted.

**CCLI usage report…**, under **Song credits** on the **Theme** tab, lists the songs used between two dates (the last six months to start with), most used first, with each one's CCLI song number, writers, how many times it was used and on which days. **Copy** puts the list on the clipboard as columns, ready to paste into a spreadsheet, and **Download CSV** saves it as a file. CCLI has no way for apps like Lumen to send a report directly, so enter the songs on the reporting page of the CCLI website. The record is kept in the library, so it is in its backups and its exported copies.

## Themes

The **Theme** tab has two lists:

- **All songs** picks the theme every presentation uses: Classic, Lower third, Scripture, Big & bold, one of your own, or the plain default. Switching songs keeps the same look with nothing to restyle.
- **This song** gives the selected presentation its own theme, which it keeps every time it goes live.

The font, size, colour and alignment controls edit the theme the selected song is shown with, and every song using that theme follows. **Save as…** stores the current settings as a new theme. The editor offers the same theme list, so a new presentation (for example a Scripture reading) can be given its theme when it is created.

### Transitions

**Transition**, on the **Theme** tab, sets how every presentation moves from one slide to the next:

| Transition | Effect | Length |
| --- | --- | --- |
| Cut | The next slide straight away | — |
| Fade | The next slide fades in over the last (the default) | 0.45 s |
| Dip to black | The last slide fades out, then the next fades in | 0.8 s |
| Push | The next slide pushes the last off to the left | 0.5 s |
| Zoom | The next slide grows into place as the last one fades away | 0.5 s |

**Seconds** beside it makes every transition take that long (up to 5), and empty goes back to each one's own length. A presentation can have its own transition, from the list beside its theme in the editor, such as a cut for a slideshow of announcements or a push for a sermon. The background changes with the slide, unless it stays the same, and messages and the logo always fade. The audience output, every browser output and NDI play the same transition, and the stage display changes at once so the band never waits for it.

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

**Phone remote.** The **Phone remote** link opens a page sized for a phone: big **Prev** and **Next** buttons, what is on screen and what comes next, and the open service's playlist. Tap a song to see its slides and tap a slide to put it live. **Clear slide**, **Clear all** and **Logo** work as they do in the console. The remote moves the slides through the console, so the console must be open on the computer running Lumen (the desktop app's window counts even when it is hidden to the tray). With several consoles open, the one on that computer takes the remote's taps.

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
| | `LUMEN_SOFFICE` | LibreOffice's `soffice`, for [importing slides](#powerpoint-and-pdf-slides); found in its usual install folders |

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
| `lumen.db` | The library: presentations, services, media list, themes and messages, in an SQLite database (with `lumen.db-wal` and `lumen.db-shm` beside it while Lumen is running) |
| `live.json` | What is on screen right now, so windows recover after a restart |
| `settings.json` | Network mode, the access token, signed-in devices and media folders (readable only by the account running the server) |
| `bibles.db` | The Bible translations in use and the ones imported, with their search index, in a database of their own |
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
| `GET /api/search?q=<words>` | Song search, best match first (`{results: [{id, name, snippet}]}`); in `snippet`, the matching words are between `\u0002` and `\u0003` |
| `GET` / `POST /api/live` | Read / set the live state (`{live}`) |
| `POST /api/remote` | What the phone remote sends to the open console: `{action: "next"}`, `{action: "prev"}`, `{action: "go", presId, idx}` or `{action: "clear", what: "all"/"slide"/"bg"/"msg"/"logo"}`; 409 when no console is open |
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
| `GET /api/events` | Server-Sent Events: `hello`, `state`, `library`, `folders`, `bibles`, `ping` |

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
| `console/songselect.js`, `console/openlyrics.js`, `console/xml.js` | Importing songs from SongSelect, OpenLyrics and OpenSong files |
| `console/usage.js`, `console/report.js` | Noting which songs went live, and the CCLI usage report dialog |
| `console/passage.js` | Bible passages as slides: packing verses and splitting long ones |
| `console/format.js` | The slide format: presentations, templates and layouts of positioned elements, converting libraries saved by earlier versions, and resolving a slide into what a screen draws |
| `console/transitions.js` | The slide transitions, and which one a presentation plays |
| `output.html`, `stage.html`, `render.js`, `render.css` | The audience output and stage display, and playing transitions |
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
