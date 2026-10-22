// Commands that move the show, from the phone remote, Bitfocus Companion or OSC. Each is handed to one open
// console, which carries it out just as if it were pressed there, so nothing else needs a copy of what going live
// does.
'use strict';
const { bad, nowMs } = require('./util.js');

const CLEAR = ['all', 'slide', 'bg', 'msg', 'logo'];
const VIDEO = ['toggle', 'restart'];
const TIMER = ['start', 'pause', 'reset'];
const ACTIONS = ['next', 'prev', 'nextItem', 'prevItem', 'item', 'slide', 'go', 'clear', 'video', 'auto', 'timer'];

const index = (v, what) => {
  if (!Number.isInteger(v) || v < 0) throw bad(`${what} must be a whole number from 0`);
  return v;
};
const oneOf = (v, list, what) => {
  if (!list.includes(v)) throw bad(`${what} must be one of ${list.join(', ')}`);
  return v;
};

/** The command as the console takes it, or a 400. Numbers count from 0: item is a place in the playlist, idx a
 * slide in play order. */
function command(body) {
  switch (body.action) {
    case 'next': case 'prev': case 'nextItem': case 'prevItem': case 'auto': return { action: body.action };
    case 'item': return { action: 'item', item: index(body.item, 'item') };
    case 'slide': return { action: 'slide', idx: index(body.idx, 'idx') };
    case 'go':
      if (typeof body.presId !== 'string' || !body.presId) throw bad('presId is missing');
      return { action: 'go', presId: body.presId, idx: index(body.idx, 'idx') };
    case 'clear': return { action: 'clear', what: oneOf(body.what, CLEAR, 'what') };
    case 'video': return { action: 'video', what: oneOf(body.what, VIDEO, 'what') };
    case 'timer': return { action: 'timer', what: oneOf(body.what, TIMER, 'what') };
    default: throw bad(`action must be one of ${ACTIONS.join(', ')}`);
  }
}

/** Hand a command to the console that moves the slides. False when none is open. */
function dispatch(hub, cmd) {
  const target = hub.console();
  if (!target) return false;
  hub.sendTo(target, 'remote', { ...cmd, time: nowMs() });
  return true;
}

module.exports = { command, dispatch, CLEAR, VIDEO, TIMER };
