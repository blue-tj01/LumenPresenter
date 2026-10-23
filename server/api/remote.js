// @ts-check
// The phone remote (remote.html) and Bitfocus Companion: their commands are handed to one open console (see
// control.js).
'use strict';
const { command, dispatch } = require('../control.js');

module.exports = {
  async 'POST remote'() {
    const cmd = command(await this.readBodyJson());
    if (!dispatch(this.srv.hub, cmd))
      return this.error(409, 'no console is open — open Lumen on the computer running it');
    this.sendJson({ ok: true });
  },
};
