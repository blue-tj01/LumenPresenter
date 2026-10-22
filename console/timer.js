// The clock, countdown timer, video time, auto-advance, and stage messages.
import { $, toast } from './dom.js';
import { autoSecs, getPres } from './library.js';
import { autoRemaining, autoStep, broadcast, live, liveVideoEl, videoPos } from './live.js';

// ---------- timer & clock ----------
const fmt = sec => { const neg = sec < 0; sec = Math.abs(Math.round(sec)); const m = Math.floor(sec / 60), s = sec % 60; return (neg ? '-' : '') + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0'); };
const timerRemaining = () => live.timer.endAt ? (live.timer.endAt - Lumen.now()) / 1000 : live.timer.remaining;

/** Start, pause or reset the countdown. */
export function timerControl(what) {
  const t = live.timer;
  if (what === 'start' && !t.endAt) live.timer.endAt = Lumen.now() + t.remaining * 1000;
  else if (what === 'pause' && t.endAt) { live.timer.remaining = timerRemaining(); live.timer.endAt = null; }
  else if (what === 'reset') live.timer = { dur: t.dur, endAt: null, remaining: t.dur };
  else return;
  broadcast();
}

/** Wire up the clock, timer and stage message controls; called once the library has loaded. */
export function setupTimer() {
  setInterval(() => {
    $('#clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const r = timerRemaining();
    $('#timerBig').textContent = fmt(r); $('#timerBig').classList.toggle('neg', r < 0);
    const v = liveVideoEl();
    if (v && live.slide.play) {
      const dur = isFinite(v.duration) ? v.duration : 0, at = Math.max(0, videoPos(live.slide.play));
      $('#vidTime').textContent = fmt(dur ? Math.min(at, dur) : at) + (dur ? ' / ' + fmt(dur) : '');
    }
    const ar = autoRemaining();
    if (ar !== null && ar <= 0) autoStep();
    else if (live.slide && autoSecs(getPres(live.presId))) {
      $('#btnAuto').firstChild.textContent = live.autoOff ? '▶ Auto' : '❚❚ Auto';
      $('#autoLeft').textContent = ar === null ? '' : fmt(Math.ceil(ar));
    }
  }, 250);

  $('#timerSet').onclick = () => { const s = Math.max(0, +$('#timerMin').value) * 60; live.timer = { dur: s, endAt: null, remaining: s }; broadcast(); };
  for (const what of ['start', 'pause', 'reset']) $(`#timer${what[0].toUpperCase()}${what.slice(1)}`).onclick = () => timerControl(what);
  $('#stageSend').onclick = () => { live.stageMsg = $('#stageInput').value.trim(); broadcast(); toast('Sent to stage'); };
  $('#stageInput').onkeydown = e => { if (e.key === 'Enter') $('#stageSend').click(); };
  $('#stageClear').onclick = () => { live.stageMsg = ''; $('#stageInput').value = ''; broadcast(); };
}
