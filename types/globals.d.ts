// What the pages share as globals: sync.js's link to the server (window.Lumen) and render.js's renderer
// (window.PP). Loosely typed for now; the console's modules are checked against these names.
declare var Lumen: any;
declare var PP: any;
interface Window {
  Lumen: any; PP: any;
  /** The desktop app's additions (electron/preload.js); missing in a browser. */
  lumenDesktop?: {
    pickFolder(): Promise<string>;
    displays(): Promise<{ displays: { id: number; name: string }[]; chosen: { output: number | null; stage: number | null } } | null>;
    setScreen(name: string, id: number | null): Promise<boolean>;
    identifyScreens(): Promise<void>;
  };
}
