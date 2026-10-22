// Bitfocus Companion module for Lumen Presenter: buttons that move the show, and variables and feedbacks that
// follow what is on screen.
'use strict';
const { InstanceBase, InstanceStatus, Regex, combineRgb, runEntrypoint } = require('@companion-module/base');
const { LumenClient } = require('./lumen.js');
const { VARIABLES, variables, flags } = require('./state.js');

const WHITE = combineRgb(255, 255, 255), BLACK = combineRgb(0, 0, 0);
const BLUE = combineRgb(79, 124, 255), RED = combineRgb(200, 0, 0), GREEN = combineRgb(0, 150, 70);
const AMBER = combineRgb(230, 150, 0), GREY = combineRgb(40, 44, 52);

const CLEAR = [
  { id: 'all', label: 'Everything' }, { id: 'slide', label: 'Slide' },
  { id: 'bg', label: 'Background' }, { id: 'msg', label: 'Message' },
];
const FLAGS = [
  { id: 'slide', label: 'A slide is on screen' }, { id: 'background', label: 'A background is on screen' },
  { id: 'message', label: 'A message is on screen' }, { id: 'logo', label: 'The logo is showing' },
  { id: 'cleared', label: 'The screen is clear' }, { id: 'videoPlaying', label: 'A video is playing' },
  { id: 'timerRunning', label: 'The timer is running' }, { id: 'timerOver', label: 'The timer has run out' },
];

class LumenInstance extends InstanceBase {
  async init(config) {
    this.live = null;
    this.offset = 0; // Lumen's clock minus ours
    this.setActionDefinitions(this.actions());
    this.setFeedbackDefinitions(this.feedbacks());
    this.setVariableDefinitions(VARIABLES.map(([variableId, name]) => ({ variableId, name })));
    this.setPresetDefinitions(this.presets());
    this.tick = setInterval(() => this.refresh(false), 1000); // the timer and clock
    await this.configUpdated(config);
  }

  async destroy() {
    clearInterval(this.tick);
    this.client?.stop();
  }

  async configUpdated(config) {
    this.config = config;
    this.client?.stop();
    this.client = new LumenClient({
      host: (config.host || '127.0.0.1').trim(), port: Number(config.port) || 8642, token: config.token || '',
      onLive: (live, offset) => { this.live = live; this.offset = offset; this.refresh(true); },
      onStatus: (state, why) => {
        if (state === 'ok') this.updateStatus(InstanceStatus.Ok);
        else if (state === 'connecting') this.updateStatus(InstanceStatus.Connecting);
        else if (state === 'auth') this.updateStatus(InstanceStatus.AuthenticationFailure, why);
        else this.updateStatus(InstanceStatus.ConnectionFailure, why);
      },
    });
    this.client.start();
  }

  getConfigFields() {
    return [
      { type: 'static-text', id: 'info', width: 12, label: '',
        value: 'The address, port and token are in the Control tab of the Lumen console.' },
      { type: 'textinput', id: 'host', label: 'Lumen computer\'s address', width: 8, default: '127.0.0.1', regex: Regex.SOMETHING },
      { type: 'number', id: 'port', label: 'Port', width: 4, default: 8642, min: 1, max: 65535 },
      { type: 'textinput', id: 'token', label: 'Access token (only needed in network mode)', width: 8, default: '' },
    ];
  }

  /** Update the variables, and the feedbacks that may have changed. */
  refresh(changed) {
    const now = Date.now() + this.offset;
    this.setVariableValues(variables(this.live, now));
    if (changed) this.checkFeedbacks('state');
    else if (this.live?.timer?.endAt) this.checkFeedbacks('state'); // the timer may just have run out
  }

  async send(cmd) {
    try { await this.client.send(cmd); }
    catch (e) { this.log('warn', `Lumen did not take ${cmd.action}: ${e.message}`); }
  }

  actions() {
    const simple = (name, cmd) => ({ name, options: [], callback: () => this.send(cmd) });
    const number = (id, label) => ({ type: 'number', id, label, default: 1, min: 1, max: 999 });
    return {
      next: simple('Next slide', { action: 'next' }),
      prev: simple('Previous slide', { action: 'prev' }),
      next_item: simple('Next presentation in the playlist', { action: 'nextItem' }),
      prev_item: simple('Previous presentation in the playlist', { action: 'prevItem' }),
      go_item: { name: 'Go to a presentation in the playlist', options: [number('item', 'Place in the playlist (from 1)')],
        callback: e => this.send({ action: 'item', item: Math.max(1, Math.round(e.options.item)) - 1 }) },
      go_slide: { name: 'Go to a slide of the live presentation', options: [number('slide', 'Slide (from 1, in play order)')],
        callback: e => this.send({ action: 'slide', idx: Math.max(1, Math.round(e.options.slide)) - 1 }) },
      clear: { name: 'Clear', options: [{ type: 'dropdown', id: 'what', label: 'What', default: 'all', choices: CLEAR }],
        callback: e => this.send({ action: 'clear', what: e.options.what }) },
      logo: simple('Logo on or off', { action: 'clear', what: 'logo' }),
      video: { name: 'Video', options: [{ type: 'dropdown', id: 'what', label: 'Do', default: 'toggle',
        choices: [{ id: 'toggle', label: 'Play or pause' }, { id: 'restart', label: 'Restart' }] }],
        callback: e => this.send({ action: 'video', what: e.options.what }) },
      auto: simple('Pause or resume auto-advance', { action: 'auto' }),
      timer: { name: 'Timer', options: [{ type: 'dropdown', id: 'what', label: 'Do', default: 'start',
        choices: [{ id: 'start', label: 'Start' }, { id: 'pause', label: 'Pause' }, { id: 'reset', label: 'Reset' }] }],
        callback: e => this.send({ action: 'timer', what: e.options.what }) },
    };
  }

  feedbacks() {
    return {
      state: {
        type: 'boolean', name: 'What is on screen',
        description: 'Changes the button\'s look while this is true',
        defaultStyle: { bgcolor: RED, color: WHITE },
        options: [{ type: 'dropdown', id: 'when', label: 'When', default: 'slide', choices: FLAGS }],
        callback: fb => !!flags(this.live, Date.now() + this.offset)[fb.options.when],
      },
    };
  }

  presets() {
    const v = name => `$(${this.label}:${name})`;
    const button = (category, name, text, actionId, options = {}, feedback = null, bgcolor = GREY) => ({
      type: 'button', category, name,
      style: { text, size: 'auto', color: WHITE, bgcolor },
      steps: [{ down: [{ actionId, options }], up: [] }],
      feedbacks: feedback ? [{ feedbackId: 'state', options: { when: feedback.when }, style: feedback.style }] : [],
    });
    const lit = (when, bgcolor = RED) => ({ when, style: { bgcolor, color: WHITE } });
    return {
      prev: button('Slides', 'Previous slide', '◀\nPrev', 'prev'),
      next: button('Slides', 'Next slide', 'Next\n▶', 'next', {}, null, BLUE),
      prev_item: button('Slides', 'Previous presentation', '⏮\nPrev song', 'prev_item'),
      next_item: button('Slides', 'Next presentation', 'Next song\n⏭', 'next_item'),
      live: button('Slides', 'What is live (press for next slide)', `${v('presentation')}\n${v('group')}`, 'next', {}, lit('slide', GREEN), BLACK),
      clear_all: button('Clear', 'Clear everything', 'Clear\nall', 'clear', { what: 'all' }, lit('cleared', BLACK), RED),
      clear_slide: button('Clear', 'Clear slide', 'Clear\nslide', 'clear', { what: 'slide' }, lit('slide', AMBER)),
      clear_bg: button('Clear', 'Clear background', 'Clear\nback-\nground', 'clear', { what: 'bg' }, lit('background', AMBER)),
      clear_msg: button('Clear', 'Clear message', 'Clear\nmessage', 'clear', { what: 'msg' }, lit('message', AMBER)),
      logo: button('Clear', 'Logo on or off', 'Logo', 'logo', {}, lit('logo', GREEN)),
      video: button('Media', 'Play or pause the video', '⏯\nVideo', 'video', { what: 'toggle' }, lit('videoPlaying', GREEN)),
      video_restart: button('Media', 'Restart the video', '⟲\nVideo', 'video', { what: 'restart' }),
      auto: button('Media', 'Pause or resume auto-advance', 'Auto', 'auto'),
      timer: button('Timer', 'Start the timer', `Timer\n${v('timer')}`, 'timer', { what: 'start' }, lit('timerOver')),
      timer_pause: button('Timer', 'Pause the timer', 'Pause\ntimer', 'timer', { what: 'pause' }, lit('timerRunning', GREEN)),
      timer_reset: button('Timer', 'Reset the timer', 'Reset\ntimer', 'timer', { what: 'reset' }),
    };
  }
}

runEntrypoint(LumenInstance, []);
