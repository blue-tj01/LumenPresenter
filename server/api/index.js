// The HTTP API, one handler per 'METHOD name' (/api/<name>[/...]). Each runs with `this` as the Request.
'use strict';

module.exports = {
  ...require('./events.js'),
  ...require('./network.js'),
  ...require('./library.js'),
  ...require('./media.js'),
  ...require('./scripture.js'),
  ...require('./remote.js'),
};
