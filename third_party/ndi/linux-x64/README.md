# NDI library for the Linux builds

The Linux AppImage and deb carry the NDI® library from this folder, packed into `resources/ndi`, so NDI output works without anyone installing the NDI SDK. Lumen looks there after `LUMEN_NDI_LIB` and `NDI_RUNTIME_DIR_V6`, and before the system library path (see `electron/ndi-lib.js`).

To add or update it, download the [NDI SDK for Linux](https://ndi.video/for-developers/ndi-sdk/), run its installer, then from this folder:

```bash
SDK="path/to/NDI SDK for Linux"
cp -L "$SDK/lib/x86_64-linux-gnu/libndi.so.6" .          # -L copies the real file, not the symlink
cp "$SDK/NDI SDK License Agreement.pdf" .                 # or whatever the licence file at the SDK's top level is called
cp "$SDK/licenses/libndi_licenses.txt" . 2>/dev/null || true
```

Commit the files here. Keep the version current: the NDI SDK terms ask that what you ship is kept up to date. Without `libndi.so.6` here the build still works, and Lumen falls back to asking for the NDI SDK.

Shipping it is allowed by the NDI SDK's Software Distribution terms, provided Lumen shows a link to [ndi.video](https://ndi.video/) where NDI is chosen (the NDI Output menu), the trademark statement in the About box and docs, keeps the library in its own folder rather than the system path, and follows the NDI SDK License Agreement. Lumen's GPL licence gives the additional permission in [`NOTICE`](../../../NOTICE) to combine Lumen with the NDI library.

NDI® is a registered trademark of Vizrt NDI AB.
