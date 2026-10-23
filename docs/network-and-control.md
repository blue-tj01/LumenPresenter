# Network mode and outside control

## Network mode

Lumen starts local-only. To drive screens from other machines (a stage display on a laptop, the output on a second computer, a second operator console), open **Setup → Network** in the console and turn on **Network mode**. The change takes effect immediately, with no restart.

**Token links.** **Setup → Network** shows a link for the operator console, the audience output and the stage display, each carrying the access token. Opening a link once signs that device in with a cookie that stands for the device rather than the token, and the token is removed from the address bar.

**Phone remote.** The **Phone remote** link opens a page sized for a phone: big **Prev** and **Next** buttons, what is on screen and what comes next, and the open service's playlist. Tap a song to see its slides and tap a slide to put it live. **Clear slide**, **Clear all** and **Logo** work as they do in the console. The remote moves the slides through the console, so the console must be open on the computer running Lumen (the desktop app's window counts even when it is hidden to the tray). With several consoles open, the one on that computer takes the remote's taps.

**Access.** In network mode other devices need the token to see anything, not just to change it; a device that opens Lumen without a link is asked for it. The computer running Lumen never is. The network setting and token can only be viewed or changed on that computer.

**Devices.** **Setup → Network** lists signed-in devices and what each is showing. **Disconnect** (or **Disconnect all**) signs a device out and returns it to the token page. A console on another device has **Sign out of this device** under its own Setup → Network.

**Rotating the token.** Anyone who knows the token can sign back in, so **New** generates a fresh token and signs every device out until it is given the new one.

The token is generated the first time the server starts and is saved, along with the network setting, in `settings.json` in the data directory. Updating or replacing the app's files leaves it untouched, so both survive upgrades and restarts.

## Companion, OSC and MIDI

**Setup → Control** in the console sets up control from outside Lumen. Whatever sends the command, the console carries it out just as if its own button were pressed, so the console must be open. With more than one console open, the one on the computer running Lumen takes the commands.

### Bitfocus Companion

The Lumen Presenter module for [Bitfocus Companion](https://bitfocus.io/companion) (3.5 or later) puts Lumen on a Stream Deck or any other Companion surface.

- **Actions:** next and previous slide, next and previous presentation in the playlist, go to a presentation by its place in the playlist or to a slide of the live presentation, clear everything, the slide, the background or the message, the logo, play, pause or restart the video, pause or resume auto-advance, and start, pause or reset the timer.
- **Feedbacks:** a button lights up while a slide, background, message or the logo is showing, while the screen is clear, while a video plays, while the timer runs, or once it has run out.
- **Variables:** the live presentation, its group (Verse 1, Chorus), the slide number, the slide's words, the next slide's words, the message, the timer and the clock.
- **Presets:** ready-made buttons for all of these, under **Presets** in Companion.

**Installing the module.** Each release has a `lumen-presenter-companion-<version>.tgz` file. In Companion 4.1 or later, open **Modules**, choose **Import module package** and pick that file. In older versions, unpack it into a folder and point **Settings → Developer modules path** at the folder that holds it. The module's source is in [`companion-module/`](../companion-module), and `npm install && npm run build` there makes the package.

**Connecting.** Add a **Lumen Presenter** connection in Companion and enter what **Setup → Control** shows:

- **Companion on the computer running Lumen:** address `127.0.0.1`, port `8642`, no token.
- **Companion on another computer:** turn on network mode, then enter this computer's address and the access token. Making a new token under Setup → Network disconnects Companion until the new one is entered.

### OSC

Lumen listens for OSC on UDP port 8643 once **Listen for OSC** is turned on under **Setup → Control**. OSC carries no token, so it only takes messages from the computer running Lumen unless **Take OSC from other devices** is also turned on, and that needs network mode as well. Anyone on the network can then move the slides, so only turn it on for a network you trust.

Numbers count from 1, and can be in the address (`/lumen/slide/3`) or its argument (`/lumen/slide 3`). A button that sends 1 when pressed and 0 when let go, as TouchOSC and many lighting desks do, moves the slides once.

| Address | Does |
| --- | --- |
| `/lumen/next`, `/lumen/prev` | Next or previous slide, on into the next presentation in the playlist |
| `/lumen/item/next`, `/lumen/item/prev` | First slide of the next or previous presentation in the playlist |
| `/lumen/item/<n>` | First slide of the playlist's nth presentation |
| `/lumen/slide/<n>` | The nth slide of the live presentation (or the selected one) |
| `/lumen/clear/all`, `/slide`, `/bg`, `/msg` | Clear everything, the slide, the background or the message |
| `/lumen/logo` | Logo on or off |
| `/lumen/video/toggle`, `/lumen/video/restart` | Play or pause, or restart, the live video |
| `/lumen/auto` | Pause or resume auto-advance |
| `/lumen/timer/start`, `/pause`, `/reset` | The countdown timer |

### MIDI

Turn on **Take MIDI on this computer** under **Setup → Control** to step through the service from a MIDI keyboard, pad controller or foot pedal plugged into the computer running the console. For each action, choose **Learn** and press the key, pad, pedal or button to use. Notes, controllers (a button sending 64 or more) and program changes all work, from any device or the one chosen. The setup is kept with that computer.

MIDI works in the Lumen app, and in Chrome or Edge on the computer running Lumen. Browsers only offer MIDI to pages on the same computer or over HTTPS, so a console opened on another device can't use it.
