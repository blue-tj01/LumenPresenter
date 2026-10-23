// @ts-check
// MIDI control: which button, key, pedal or fader a MIDI message comes from, and what each one is set to do.
// The console listens through the browser's Web MIDI, so it needs nothing installed (control.js wires it up).

/** What a MIDI button can be set to do, with the command the console carries out (as the phone remote sends).
 * @type {[string, string, { action: string, what?: string }][]} */
export const MIDI_ACTIONS = [
  ['next', 'Next slide', { action: 'next' }],
  ['prev', 'Previous slide', { action: 'prev' }],
  ['nextItem', 'Next presentation', { action: 'nextItem' }],
  ['prevItem', 'Previous presentation', { action: 'prevItem' }],
  ['clearAll', 'Clear all', { action: 'clear', what: 'all' }],
  ['clearSlide', 'Clear slide', { action: 'clear', what: 'slide' }],
  ['clearBg', 'Clear background', { action: 'clear', what: 'bg' }],
  ['clearMsg', 'Clear message', { action: 'clear', what: 'msg' }],
  ['logo', 'Logo on or off', { action: 'clear', what: 'logo' }],
  ['video', 'Play or pause the video', { action: 'video', what: 'toggle' }],
  ['auto', 'Pause or resume auto-advance', { action: 'auto' }],
  ['timerStart', 'Start the timer', { action: 'timer', what: 'start' }],
  ['timerPause', 'Pause the timer', { action: 'timer', what: 'pause' }],
  ['timerReset', 'Reset the timer', { action: 'timer', what: 'reset' }],
];

/** The trigger a MIDI message is, as 'note:<channel>:<number>', 'cc:...' or 'pc:...' (channels 1-16), or null
 * for one that doesn't press anything: a key or pad let go, a controller below half way, clock and the like.
 * `held` remembers which controllers are up, so a fader moved past half way fires once, not on every step, and
 * when each trigger last fired: the same one again within REPEAT_MS is the same press arriving twice (a device
 * seen through more than one port, such as a software keyboard also wired to Midi Through), so it is dropped. */
export const REPEAT_MS = 150;
export function midiTrigger(data, held = new Map(), now = Date.now()) {
  const [status, a, b] = data;
  const kind = status & 0xf0, ch = (status & 0x0f) + 1;
  let id = null;
  if (kind === 0x90 && b > 0) id = `note:${ch}:${a}`;
  else if (kind === 0xc0) id = `pc:${ch}:${a}`;
  else if (kind === 0xb0) {
    const cc = `cc:${ch}:${a}`, up = b >= 64, was = held.get(cc) || false;
    held.set(cc, up);
    if (up && !was) id = cc;
  }
  if (!id) return null;
  const last = held.get(`at:${id}`);
  held.set(`at:${id}`, now);
  return last !== undefined && now - last < REPEAT_MS ? null : id;
}

const NOTES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/** A trigger as a person reads it: 'Note C4 (60), channel 1'. Middle C (60) is C4. */
export function triggerLabel(trigger) {
  const m = /^(note|cc|pc):(\d+):(\d+)$/.exec(trigger || '');
  if (!m) return '';
  const n = Number(m[3]), ch = `channel ${m[2]}`;
  if (m[1] === 'note') return `Note ${NOTES[n % 12]}${Math.floor(n / 12) - 1} (${n}), ${ch}`;
  return m[1] === 'cc' ? `Controller ${n}, ${ch}` : `Program ${n + 1}, ${ch}`;
}

/** The saved setup, with anything missing or not understood dropped. */
export function midiSettings(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  const map = {};
  for (const [key] of MIDI_ACTIONS) if (typeof s.map?.[key] === 'string' && triggerLabel(s.map[key])) map[key] = s.map[key];
  return { on: !!s.on, device: typeof s.device === 'string' ? s.device : '', map };
}

/** The commands a trigger is set to do (one trigger can be given to more than one action). */
export const commandsFor = (settings, trigger) =>
  MIDI_ACTIONS.filter(([key]) => settings.map[key] === trigger).map(([, , cmd]) => cmd);
