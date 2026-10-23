// @ts-check
// The Network tab: network mode, the access token, links for other devices, and signed-in devices.
import { $, toast } from './dom.js';
import { ask } from './dialog.js';

// ---------- network mode ----------
function renderNetwork(n) {
  const on = $('#netOn'), note = $('#netNote');
  on.checked = !!n?.network;
  on.disabled = !n?.local || !!n.locked;
  note.textContent = !n ? 'Network mode needs the Lumen desktop app or server (node server.js).'
    : !n.local ? 'Network mode can only be changed on the computer running Lumen.'
    : n.locked ? `Set when the server was started (--host), so it can't be changed here.`
    : n.network ? 'Other devices on this network can open Lumen with the token below.'
    : 'Only this computer can open Lumen. Turn on to drive screens or a second console from other devices.';
  $('#netDetails').hidden = !(n?.local && n.network);
  $('#netSignOut').hidden = !n?.signedIn;
  if (!n?.local) return;
  renderDevices(n.devices || []);
  $('#netToken').textContent = n.token || '';
  const list = $('#netLinks'); list.innerHTML = '';
  const pages = [['Operator console', ''], ['Audience output', 'output.html'], ['Stage display', 'stage.html'],
    ['Phone remote', 'remote.html']];
  for (const addr of n.addresses?.length ? n.addresses : ['<this computer\'s address>']) {
    for (const [what, page] of pages) {
      const url = `http://${addr}:${n.port}/${page}?token=${encodeURIComponent(n.token || '')}`;
      const li = document.createElement('li');
      const label = document.createElement('span'); label.className = 'net-what';
      label.textContent = n.addresses.length > 1 ? `${what} (${addr})` : what;
      const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.textContent = url;
      const copy = document.createElement('button'); copy.className = 'btn small-btn'; copy.textContent = 'Copy';
      copy.onclick = () => navigator.clipboard?.writeText(url).then(() => toast(`${what} link copied`), () => {});
      li.append(label, a, copy); list.append(li);
    }
  }
}
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
function renderDevices(devices) {
  const list = $('#netDevices'); list.innerHTML = '';
  $('#netDropAll').hidden = devices.length < 2;
  if (!devices.length) { const li = document.createElement('li'); li.className = 'muted small'; li.textContent = 'None yet'; list.append(li); }
  for (const d of devices) {
    const li = document.createElement('li'), text = document.createElement('div');
    const name = document.createElement('span'); name.textContent = `${d.device} · ${d.address}`;
    const state = document.createElement('span'); state.className = 'small ' + (d.open.length ? 'on' : 'muted');
    state.textContent = d.open.length ? `Showing ${d.open.join(', ')}` : `Last seen ${ago(d.seen || d.created)}`;
    text.append(name, state);
    const drop = document.createElement('button'); drop.className = 'btn small-btn ghost danger'; drop.textContent = 'Disconnect';
    drop.onclick = () => changeNetwork({ disconnect: d.id });
    li.append(text, drop); list.append(li);
  }
}
const loadNetwork = () => Lumen.online ? Lumen.network().then(renderNetwork).catch(() => renderNetwork(null)) : renderNetwork(null);
async function changeNetwork(change) {
  try { renderNetwork(await Lumen.setNetwork(change)); }
  catch (e) { toast(`Network mode not changed: ${e.message}`); loadNetwork(); }
}

/** Wire up the Network tab; called once the library has loaded. */
export function setupNetwork() {
  $('#netOn').onchange = e => changeNetwork({ network: e.target.checked });
  $('#netNewToken').onclick = async () => {
    if (await ask('Make a new access token? Other consoles and phones will have to enter the new one.', { ok: 'Make a new token', danger: true })) changeNetwork({ regenerate: true });
  };
  $('#netCopy').onclick = () => navigator.clipboard?.writeText($('#netToken').textContent).then(() => toast('Token copied'), () => {});
  $('#netDropAll').onclick = async () => { if (await ask('Sign every other device out? They will need the token to come back.', { ok: 'Sign them out', danger: true })) changeNetwork({ disconnect: 'all' }); };
  $('#netSignOut').onclick = async () => { if (await ask('Sign this device out? You will need the token to open Lumen here again.', { ok: 'Sign out', danger: true })) Lumen.signOut(); };
  $('.tabs button[data-tab="net"]').addEventListener('click', loadNetwork);
  loadNetwork();
  // Keep the device list current while the tab is showing.
  setInterval(() => { if ($('[data-pane="net"]').classList.contains('on') && !document.hidden && Lumen.online) loadNetwork(); }, 5000);
}
