// The parts of pdf.js the console uses (console/powerpoint.js), so type checking doesn't read the minified library.
export const GlobalWorkerOptions: { workerSrc: string };
export function getDocument(src: { data: Uint8Array; isEvalSupported?: boolean }): { promise: Promise<any>; destroy(): Promise<void> };
