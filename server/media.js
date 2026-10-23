// @ts-check
// Which pictures, videos and fonts Lumen stores and serves, and how.
'use strict';
const path = require('path');

const MEDIA_NAME = /^[a-z0-9]{16}\.[a-z0-9]{1,5}$/;
// The stored extension decides the Content-Type the file is served with, so it must be a media type,
// never whatever the uploader's filename says (e.g. .html, which would run as a page on this origin).
const MEDIA_EXT = {
  image: new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg']),
  video: new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']),
  font: new Set(['woff2', 'woff', 'ttf', 'otf']),
};
const TYPES = {
  html: 'text/html', css: 'text/css', js: 'application/javascript', mjs: 'application/javascript', json: 'application/json',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  bmp: 'image/bmp', svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v', ogv: 'video/ogg',
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf',
};
const EXT_FOR_TYPE = Object.fromEntries(Object.entries(TYPES).filter(([e]) => !['jpeg', 'mjs'].includes(e)).map(([e, t]) => [t, e]));
// Media is only ever displayed, never run: neutralises scripts in an SVG opened directly.
const MEDIA_CSP = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox";

const mediaKind = name => {
  const ext = path.extname(name).slice(1).toLowerCase();
  return MEDIA_EXT.image.has(ext) ? 'image' : MEDIA_EXT.video.has(ext) ? 'video' : null;
};

module.exports = { MEDIA_NAME, MEDIA_EXT, TYPES, EXT_FOR_TYPE, MEDIA_CSP, mediaKind };
