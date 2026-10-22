# NDI output

The desktop app can send the audience output over the network as an [NDI®](https://ndi.video) source, which vMix, Wirecast, OBS, NDI Studio Monitor and other NDI receivers pick up directly. It sends exactly what the audience output shows, at a steady frame rate, whether or not an output window is open.

1. Install the free [NDI Tools](https://ndi.video/tools/) on the computer running Lumen, which installs the NDI Runtime Lumen uses. If Lumen was open while you installed it, choose **Screens → NDI Output → Look for NDI Again**.
2. Turn on **Screens → NDI Output → Send Audience Output over NDI**. The source appears on the network as *COMPUTER-NAME (Lumen Presenter)*. The same menu shows how many receivers are watching.
3. Choose the size (720p, 1080p or 4K) and frame rate (25, 30, 50 or 60) in the same menu. 1080p at 30 is the default. Higher settings use more processor time and network bandwidth.

**Words only, for streaming.** **Screens → NDI Output → Words Only, on a Transparent Background**, on to start with, sends just the words, using the same template as the audience output, with see-through pixels everywhere else. OBS, Ecamm Live, vMix and other receivers that take NDI with alpha lay the words straight over their own camera or scene, with no black box to key out. A video in the playlist, or on a slide with `@video:`, still plays over the stream, and once it ends or the next slide goes up the stream is see-through again. Backgrounds (including a video chosen from the media bin), pictures on slides (including imported PowerPoint and PDF slides, which are pictures) and the logo screen are left out; messages and any box the template draws behind the words stay. Turn it off to send the whole audience output. In OBS or Ecamm, add it as an NDI source and place it above the camera.

NDI carries the picture only. Video sound plays from the computer running Lumen, as it does now. NDI stays on, and comes back on the next time Lumen starts, until it's turned off. The first time, Windows may ask whether Lumen can use the network: allow it on private networks so receivers can find the source.

**On Linux.** NDI Tools isn't made for Linux, so step 1 is different: download the [NDI SDK for Linux](https://ndi.video/for-developers/ndi-sdk/) and run its installer, which unpacks a `NDI SDK for Linux` folder. Lumen needs `libndi.so.6` from its `lib/x86_64-linux-gnu` folder. Either copy it to where the system finds libraries:

```bash
sudo cp -P "NDI SDK for Linux/lib/x86_64-linux-gnu/"libndi.so* /usr/local/lib/ && sudo ldconfig
```

or set `NDI_RUNTIME_DIR_V6` to that folder before starting Lumen. NDI Studio Monitor isn't made for Linux either: to watch the source on the same computer, use OBS with the DistroAV plugin, or watch from a Windows or Mac computer on the network. Receivers find the source only on the same network segment, so guest Wi-Fi or a router that keeps devices apart can hide it.

These choices belong to the computer, not the library, so they are kept in Lumen's own settings folder (`%APPDATA%\lumen-presenter\desktop.json` on Windows, `~/.config/lumen-presenter/desktop.json` on Linux) rather than in the data folder.
