// What is on Lumen's screen, as Companion variables and feedbacks.
'use strict';

const VARIABLES = [
  ['presentation', 'Live presentation'],
  ['group', 'Live group (Verse 1, Chorus, ...)'],
  ['slide_number', 'Live slide number, from 1'],
  ['slide_text', 'Live slide text'],
  ['next_text', 'Next slide text'],
  ['message', 'Message on screen'],
  ['timer', 'Countdown timer (mm:ss)'],
  ['clock', 'Lumen clock (hh:mm)'],
];

const two = n => String(n).padStart(2, '0');
const mmss = sec => {
  const neg = sec < 0, s = Math.abs(Math.round(sec));
  return `${neg ? '-' : ''}${two(Math.floor(s / 60))}:${two(s % 60)}`;
};

/** Seconds left on the countdown at server time now. */
function timerLeft(live, now) {
  const t = live?.timer;
  if (!t) return 0;
  return t.endAt ? (t.endAt - now) / 1000 : Number(t.remaining) || 0;
}

/** Variable values for a live state, at server time `now` (ms). */
function variables(live, now = Date.now()) {
  const slide = live?.slide || null;
  const label = String(slide?.label || '');
  const cut = label.lastIndexOf(' — ');
  const d = new Date(now);
  return {
    presentation: slide ? (cut >= 0 ? label.slice(0, cut) : label) : '',
    group: slide && cut >= 0 ? label.slice(cut + 3) : '',
    slide_number: slide && live.idx >= 0 ? String(live.idx + 1) : '',
    slide_text: String(slide?.stageText || ''),
    next_text: String(live?.next || ''),
    message: String(live?.msg || ''),
    timer: mmss(timerLeft(live, now)),
    clock: `${two(d.getHours())}:${two(d.getMinutes())}`,
  };
}

/** Which of the things a button can light up for are true. */
function flags(live, now = Date.now()) {
  return {
    slide: !!live?.slide,
    background: !!live?.bg,
    message: !!live?.msg,
    logo: !!live?.logo,
    cleared: !live?.slide && !live?.bg && !live?.msg && !live?.logo,
    videoPlaying: !!(live?.slide?.video && live.slide.play && !live.slide.play.paused),
    timerRunning: !!live?.timer?.endAt,
    timerOver: timerLeft(live, now) < 0,
  };
}

module.exports = { VARIABLES, variables, flags, mmss };
