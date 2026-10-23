# Using Lumen

How to build services, write slides and put words, scripture, pictures and videos on screen.

- [First-time setup](#first-time-setup)
- [Pages](#pages)
- [Writing slides](#writing-slides)
- [Scripture](#scripture)
- [Images and videos](#images-and-videos)
- [Song search and CCLI](#song-search-and-ccli)
- [Themes](#themes)
- [Keyboard shortcuts](#keyboard-shortcuts)

## First-time setup

The first time the console opens on a new library, a few short steps get it ready for a first service: keep the demo hymns or start empty, choose the display for the audience output and the stage display (in the desktop app; in a browser it says how to place the windows), import songs and enter the church's CCLI licence number, and pick the look of the words. Each step can be skipped, and **Library… → Run the first-time setup again…** brings it back.

## Pages

| Page | Purpose |
| --- | --- |
| `index.html` | **Operator console:** library, playlist, slide grid, live preview, media bin, themes, messages and timer |
| `output.html` | **Audience output:** open it on the projector and double-click (or press <kbd>F</kbd>) for full screen |
| `stage.html` | **Stage display:** clock, countdown, current and next slide, and stage-only messages |
| `remote.html` | **Phone remote:** next and previous, what is on screen and next, the service's playlist with its slides, and clear buttons |

With the server running, any of these pages can be opened on any device that can reach it.

## Library, backups and starting over

**Library…** in the top bar exports the whole library to a file, imports one (replacing this library on every screen), and lists the backups Lumen keeps: one every 10 minutes while the library changes, the latest 50 and the last of each day for a month before them, plus one before every import, restore or start over. **Restore…** puts one back, keeping the library it replaces as a backup, so a restore can be undone the same way. **Start over with the demo library…** asks you to type START OVER first.

When two consoles change the same song at the same moment, the change saved first is kept and the other console says which song it was, so nothing is overwritten without anyone knowing.

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
| `**bold**`, `*italic*`, `__underlined__` | Formats those words only. |
| `{gold}words{/}` | Colours those words: gold, red, blue, green, purple, white, any CSS colour name, or `{#ff9800}`. |

To format words without typing the marks, select them and use the bar above the text: **B**, *I*, U, the colour dots, or the colour picker for any other colour. Ctrl+B, Ctrl+I and Ctrl+U work too, and clicking a style again takes it off. A mark without its partner, such as a lone `*`, shows as it is typed, and `\*` always does. Search, the stage display and imports see the plain words. On a theme that is already bold, bold words show in the heaviest weight the font has, so a colour stands out more.

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

### Moving from ProPresenter 7

ProPresenter songs come in the same way, through **⤓ Songs** or by dropping the files onto the library:

- **Songs:** the `.pro` files in ProPresenter's library folder (`Documents/ProPresenter/Libraries` by default), many at a time.
- **Bundles and playlists:** a `.probundle` or `.proplaylist` exported from ProPresenter brings in every song it holds.

Each song keeps its slides as they were, its groups (Verse 1, Chorus and so on, colour-coded by their names), its arrangements as play orders, with the one selected in ProPresenter playing, and its CCLI details: writers, copyright year and publisher, and song number. Only the words come in: slide designs, backgrounds and media are left out, and the song takes your Lumen theme. A group copied under the same name with the same words plays again rather than coming in twice. As with SongSelect, a song already in the library is left as it is.

### Moving from EasyWorship

**EasyWorship 6 and 7.** Their songs are in two files, `Songs.db` and `SongWords.db`, in the `Databases\Data` folder of its profile (usually `Documents\Softouch\Easyworship\Default\v6.1\Databases\Data`, or `v7.1` for EasyWorship 7). Choose **both** through **⤓ Songs**, or drop both onto the library, while EasyWorship is closed. Each song comes in with its slides as they were, its sections (the names EasyWorship shows above them) as groups, a section sung again played again, and its author, copyright, administrator and CCLI song number. Songs with no words, such as ones that only play a video, are left out.

**EasyWorship 2009.** It keeps its songs in two files in its data folder, `Songs.DB` and `Songs.MB` (usually under `Documents\Softouch\EasyWorship\<your profile>\Databases\Data`). Choose **both** through **⤓ Songs**, or drop both onto the library: Songs.DB holds the titles and details and Songs.MB the words. Copy them while EasyWorship is closed.

Each song's slides come in as they were, a blank line apart in EasyWorship. A slide that starts with a section name on a line of its own (Verse 1, Chorus, Pre-Chorus, Bridge, Tag and so on) starts that group; a section sung again with the same words plays again, in the order the song has it. Writers, copyright (with any administrator) and song number come in too. Backgrounds and fonts are left out, as are songs with no words, such as ones that only play a video. As with SongSelect, a song already in the library is left as it is.

### CCLI usage report

Lumen keeps the record a CCLI licence asks for. Each time a song with a CCLI song number goes live, it is noted with the day and the open service, once however many of its slides are shown. Going back to it later in the same service doesn't count it again, but the same song in an evening service on the same day counts as a second use. Songs without a CCLI song number, such as notices or your own songs, aren't counted.

**CCLI usage report…**, under **Song credits** on the **Theme** tab, lists the songs used between two dates (the last six months to start with), most used first, with each one's CCLI song number, writers, how many times it was used and on which days. **Copy** puts the list on the clipboard as columns, ready to paste into a spreadsheet, and **Download CSV** saves it as a file. CCLI has no way for apps like Lumen to send a report directly, so enter the songs on the reporting page of the CCLI website. The record is kept in the library, so it is in its backups and its exported copies.

## Themes

The **Theme** tab has two lists:

- **All songs** picks the theme every presentation uses: Classic, Lower third, Scripture, Big & bold, one of your own, or the plain default. Switching songs keeps the same look with nothing to restyle.
- **This song** gives the selected presentation its own theme, which it keeps every time it goes live.

The font, size, colour and alignment controls edit the theme the selected song is shown with, and every song using that theme follows. **Save as…** stores the current settings as a new theme. The editor offers the same theme list, so a new presentation (for example a Scripture reading) can be given its theme when it is created.

### Editing a theme's layout

**Edit layout…**, on the **Theme** tab, opens the theme the selected song is shown with in a full-window editor. The canvas is drawn exactly as the screens draw it.

- **Move and resize** anything by dragging it and its handles. Edges and middles snap to the screen's middle, a 5% safe margin and the other elements; hold Alt to place freely, and Shift to keep a corner's shape or turn in 15° steps. Arrow keys nudge by a pixel, or 10 with Shift.
- **Add** a text box, a box, a circle, a line, a picture or a video from the toolbar. A text box shows its own words, or the slide's words, the song title, the group name, the song credits, a Bible reference or one of the song's details, chosen under **Shows**. **Show on** puts it on every slide, or only the first or last.
- **Layers**, on the left, lists everything front to back. Drag a row to put it in front of or behind the others, and use its eye and lock to hide it or stop it moving. **Place** on the song credits row adds the credits to the theme, so you can move and style them; until then they sit at the bottom of the last slide.
- **The inspector**, on the right, sets the exact position and size in screen pixels, and the font, colour, shadow, outline, spacing, a box behind the words, a shape's fill and border, a line's thickness, or how a picture fits its box. Fills can be a colour or a two-colour gradient. A text box's own words have the same formatting bar as the text editor.
- **Every slide** of a song, picked under **Preview with**, is shown along the bottom with the theme, and a slide whose words had to shrink to fit is marked. Click one to show it on the canvas.
- **Background**, at the bottom of the layers list, gives the theme a colour, a two-colour gradient, a picture or a video. It shows behind every presentation using the theme that has no background of its own; videos in the playlist and imported slide decks don't take it.

- **Layouts**, above the layers, lists the theme's layouts. Most slides show with **Main**; **＋ Add** makes another, such as a title or a scripture layout, starting as a copy of the one on screen. Click a layout to edit it, and use ✎ and ✕ beside it to rename or delete it. To show a slide with another layout, right-click it in the slide grid and pick the layout; the grid names it on the slide. Slides of a deleted layout show with Main again.

Nothing changes on the screens until you press **Save theme** (Ctrl+S), and every song using the theme follows. **Save as…** keeps the theme as it was and saves your changes as a new one instead, and **Cancel** (Esc) throws them away. Ctrl+Z and Ctrl+Y undo and redo, Ctrl+D duplicates the selected element, and Delete removes it. Every theme keeps the box for the slide's words: hide it rather than delete it.

### Designing one slide

Right-click a slide in the slide grid for its menu:

- **Design this slide…** opens it in the same editor, starting from its theme with its words in their own text box. Move things, change the words, add a picture or a different background, and press **Save slide**. Only that slide changes; it's marked ✎ in the grid.
- **Add a designed slide after it…** opens a new slide, started from the theme, that goes in after it when you save. Use it for announcements, sermon titles and the like.
- **Use the theme again** throws a slide's design away and shows its words with the theme once more.

A designed slide's words still count for search and show on the stage display. In the text editor it appears as one line, `@slide:` followed by its id and first words: keep the line to keep the slide where it is, or delete it to remove the slide.

### Fonts

Every font list ends with **Add a font…**, which takes a `.ttf`, `.otf`, `.woff` or `.woff2` file. Lumen keeps it with the library and every screen loads it from Lumen: the audience output, NDI, and browsers in network mode, even on computers that don't have the font installed. It's named after its file, and listed with the other fonts from then on. Adding fonts needs Lumen running as the app or its server. Only use fonts your licence lets you install on the computers that show them.

### The stage display's layout

**Edit stage layout…**, under **Setup → Stage display**, opens the stage display in the same editor, starting from a layout like the standard one. Its text boxes show the current slide, the next slide, the current group, the clock, the timer or the stage message, chosen under **Shows**, and you can add your own words, shapes, lines and pictures. **Save stage display** shows it on every stage display at once. A box with nothing to show, such as the message when there is none, is left out, and the timer turns orange in its last minute and red once it runs out. **Use the standard stage display** puts the standard one back.

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
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Z</kbd> | Undo the last change to the library (a song edited or deleted, a theme, the playlist, a service); also ↶ in the top bar |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd>, <kbd>Ctrl</kbd> + <kbd>Y</kbd> | Redo; also ↷ in the top bar |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>S</kbd> | Save, in the editor |
| <kbd>Esc</kbd> | Close the editor |
