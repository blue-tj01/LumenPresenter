// What the pages share as globals: sync.js's link to the server (window.Lumen) and render.js's renderer
// (window.PP). Loosely typed for now; the console's modules are checked against these names.
declare var Lumen: any;
declare var PP: any;
interface Window { Lumen: any; PP: any; }
