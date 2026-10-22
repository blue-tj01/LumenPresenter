// The Control tab, and carrying out commands from outside the console: the phone remote, Bitfocus Companion and
// OSC (all handed over by the server), and MIDI (heard here, through Web MIDI).
import { $, toast } from './dom.js';
import { getPres } from './library.js';
import { clear, goItem, goLive, goSlide, step, stepItem, toggleAuto, videoControl } from './live.js';
import { commandsFor, MIDI_ACTIONS, midiSettings, midiTrigger, triggerLabel } from './midi.js';
import { timerControl } from './timer.js';

/** Do what a command says, as the server checked it: {action: 'next'}, {action: 'go', presId, idx}, ... */
export function runCommand(d) {
  switch (d.action) {
    case 'next': return step(1);
    case 'prev': return step(-1);
    case 'nextItem': return stepItem(1);
    case 'prevItem': return stepItem(-1);
    case 'item': return goItem(d.item);
    case 'slide': return goSlide(d.idx);
    case 'go': return getPres(d.presId) && goLive(d.presId, d.idx);
    case 'clear': return clear(d.what);
    case 'video': return videoControl(d.what === 'restart' ? 'restart' : 'toggle');
    case 'auto': return toggleAuto();
    case 'timer': return timerControl(d.what);
  }
}

// ---------- Companion and OSC ----------
function renderControl(c) {
  const facts = $('#ctlCompanion'); facts.textContent = '';
  const fact = (name, value) => {
    const li = document.createElement('li'), b = document.createElement('span'), v = document.createElement('code');
    b.textContent = name; v.textContent = value; li.append(b, v); facts.append(li);
  };
  if (c?.local) {
    fact('Host', c.network ? (c.addresses[0] || 'this computer\'s address') : '127.0.0.1 (Companion on this computer)');
    fact('Port', String(c.port));
    if (c.token) fact('Token', c.token);
  }
  $('#ctlCompanionNote').textContent = !c ? 'Companion needs the Lumen desktop app or server (node server.js).'
    : !c.local ? 'Shown on the computer running Lumen.'
    : c.network ? 'Companion on another computer connects with the token.'
    : 'For Companion on another computer, turn on network mode in the Network tab.';
  const o = c?.osc || {};
  $('#oscOn').checked = !!o.on; $('#oscOn').disabled = !c?.local;
  if (document.activeElement !== $('#oscPort')) $('#oscPort').value = o.port || 8643;
  $('#oscPort').disabled = $('#oscLan').disabled = !c?.local;
  $('#oscLan').checked = !!o.lan;
  $('#oscNote').textContent = !c?.local ? '' : !o.on ? 'Off. OSC carries no token, so only switch it on where you need it.'
    : o.error ? `Not listening: ${o.error}.`
    : o.host === '0.0.0.0' ? `Listening on UDP port ${o.port}, from any device on the network${c.addresses.length ? ` (send to ${c.addresses.join(' or ')})` : ''}.`
    : `Listening on UDP port ${o.port}, from this computer only${o.lan ? ' (other devices need network mode as well)' : ''}.`;
  $('#oscNote').classList.toggle('warn', !!(o.on && o.error));
}
const loadControl = () => Lumen.online ? Lumen.control().then(renderControl).catch(() => renderControl(null)) : renderControl(null);
async function changeOsc(change) {
  try { renderControl(await Lumen.setControl({ osc: change })); }
  catch (e) { toast(`OSC not changed: ${e.message}`); loadControl(); }
}

// ---------- MIDI ----------
const MIDI_KEY = 'lumen.midi.v1'; // kept with this computer, as its MIDI devices are
let midi = (() => { try { return midiSettings(JSON.parse(localStorage.getItem(MIDI_KEY))); } catch { return midiSettings(null); } })();
let access = null, learning = null, midiError = '';
const held = new Map();

function saveMidi() { try { localStorage.setItem(MIDI_KEY, JSON.stringify(midi)); } catch {} renderMidi(); }

function onMidi(port, e) {
  if (!midi.on || (midi.device && port.name !== midi.device)) return;
  const trigger = midiTrigger(e.data, held);
  if (!trigger) return;
  if (learning) {
    midi.map[learning] = trigger; learning = null; saveMidi();
    return;
  }
  for (const cmd of commandsFor(midi, trigger)) runCommand(cmd);
}

function listen() {
  if (!access) return;
  for (const port of access.inputs.values()) port.onmidimessage = e => onMidi(port, e);
  renderMidi();
}

async function startMidi() {
  if (access || !midi.on) return listen();
  if (!navigator.requestMIDIAccess) { midiError = 'This browser has no MIDI. Use the Lumen app, Chrome or Edge on the computer running Lumen.'; return renderMidi(); }
  try {
    access = await navigator.requestMIDIAccess();
    access.onstatechange = listen; // a device plugged in or out
    midiError = '';
    listen();
  } catch { midiError = 'MIDI was not allowed for this page.'; renderMidi(); }
}

function renderMidi() {
  $('#midiOn').checked = midi.on;
  const names = access ? [...access.inputs.values()].map(p => p.name) : [];
  const sel = $('#midiDevice'); sel.textContent = '';
  for (const name of ['', ...new Set([...names, midi.device].filter(Boolean))]) {
    const o = document.createElement('option'); o.value = name;
    o.textContent = !name ? 'Any device' : names.includes(name) ? name : `${name} (not connected)`;
    sel.append(o);
  }
  sel.value = midi.device; sel.disabled = !midi.on;
  $('#midiNote').textContent = !midi.on ? 'Off. Turn on to step through the service from a keyboard, pad, pedal or MIDI controller.'
    : midiError || (!access ? 'Waiting for MIDI…' : !names.length ? 'No MIDI device found. Plug one in.'
    : learning ? 'Press a key, pad, pedal or button on the device now.' : 'Choose Learn, then press the key or button to use.');
  $('#midiMap').hidden = !midi.on;
  const list = $('#midiMap'); list.textContent = '';
  for (const [key, label] of MIDI_ACTIONS) {
    const li = document.createElement('li'), text = document.createElement('div');
    const name = document.createElement('span'); name.textContent = label;
    const what = document.createElement('span'); what.className = 'small muted';
    what.textContent = learning === key ? 'Press it now…' : triggerLabel(midi.map[key]) || 'Not set';
    text.append(name, what);
    const learn = document.createElement('button'); learn.className = 'btn small-btn' + (learning === key ? ' primary' : '');
    learn.textContent = learning === key ? 'Cancel' : 'Learn';
    learn.onclick = () => { learning = learning === key ? null : key; renderMidi(); };
    li.append(text, learn);
    if (midi.map[key]) {
      const drop = document.createElement('button'); drop.className = 'btn small-btn ghost'; drop.textContent = 'Clear';
      drop.onclick = () => { delete midi.map[key]; saveMidi(); };
      li.append(drop);
    }
    list.append(li);
  }
}

/** Wire up the Control tab; called once the library has loaded. */
export function setupControl() {
  $('#oscOn').onchange = e => changeOsc({ on: e.target.checked });
  $('#oscLan').onchange = e => changeOsc({ lan: e.target.checked });
  $('#oscPort').onchange = e => changeOsc({ port: Math.round(+e.target.value) });
  $('#midiOn').onchange = e => { midi.on = e.target.checked; learning = null; saveMidi(); startMidi(); };
  $('#midiDevice').onchange = e => { midi.device = e.target.value; saveMidi(); };
  $('.tabs button[data-tab="ctl"]').addEventListener('click', () => { loadControl(); renderMidi(); });
  loadControl(); renderMidi();
  if (midi.on) startMidi();
}
