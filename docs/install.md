# Installing and running Lumen

## Install

Download the latest release from the [Releases page](https://github.com/blue-tj01/LumenPresenter/releases):

| System | Download |
| --- | --- |
| Windows (64-bit) | `Lumen-Presenter-Setup-<version>.exe`, an installer with Start menu and desktop shortcuts |
| Linux (64-bit) | `Lumen-Presenter-<version>-x86_64.AppImage` to run without installing (make it executable first), or `Lumen-Presenter-<version>-amd64.deb` for Debian and Ubuntu |

The installers aren't code-signed yet, so Windows may show **Windows protected your PC** the first time: choose **More info**, then **Run anyway**.

**Updates.** The Windows app and the AppImage check for a new version when they start and every few hours after. An update downloads in the background and installs the next time Lumen is closed, so it never restarts in the middle of a service; **Help → Restart to Install** installs it straight away. The `.deb` is updated by installing the newer `.deb`.

**Bringing your library in.** The installed app keeps its library in its own data folder (`%APPDATA%\lumen-presenter\data` on Windows, `~/.config/lumen-presenter/data` on Linux). To carry over a library from a copy of the source or from `server.js`, use **File → Import Library From Folder…** and choose that copy's `data` folder. Presentations, media, the network token and signed-in devices all come across, and the library the app had is kept in its backups folder. **File → Open Data Folder** shows where it lives.

## Desktop app from the source

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

## Using the app

The operator console opens in its own window, and **Audience Output** and **Stage Display** open further windows. Output windows play a video's sound straight away, without first being clicked. Only one copy of the app runs at a time; starting it again brings the console to the front.

The **Screens** menu, also on the Lumen icon in the taskbar's notification area, sets the app up for a service:

- **Audience output** and **Stage display**: choose a display for each, and it opens full screen there, with no window frame and above notifications. The choice is remembered, so both come straight back up the next time Lumen starts. If a display is unplugged its screen closes rather than landing on the operator's screen, and it reopens when the display is reconnected. **In a window** goes back to an ordinary window.
- **NDI Output** sends the audience output over the network as an NDI source. See [NDI output](ndi.md).
- **Identify Screens** shows each display's number on it for a few seconds.
- **When the Console Closes** sets what closing the console does while a screen is showing or NDI is sending: **Ask** (the default), **Quit Lumen**, or **Keep Screens Running**.
- **Keep Screens Awake** (on by default) stops the computer and its displays going to sleep while Lumen runs.
- **Start Lumen When Windows Starts** opens Lumen when you sign in to Windows. Not yet available on Linux.

With no screens showing, closing the console quits Lumen. While a screen is showing or NDI is sending, Lumen asks whether to quit, which turns them off, or keep the screens running with Lumen in the tray. Tick **Don't ask again** to remember the answer; **Screens → When the Console Closes** changes it back. While Lumen is in the tray, click its icon to bring the console back, or right-click it and choose **Quit Lumen**.

## Server only

For a headless or Linux machine, or to use your own browser, run the server on its own:

```bash
node server.js
```

Open <http://localhost:8642> for the operator console. The server pushes every change to all open windows instantly over Server-Sent Events.

After updating the app's files, restart the app or `server.js`. Until you do, the old server keeps running and the console tells you so.

## Moving from `server.py`

Earlier versions ran on a Python server. The Node server reads and writes the same data folder in the same format, so the library, media, network setting, token and signed-in devices all carry over. Stop `server.py` before starting Lumen, as both use port 8642.
