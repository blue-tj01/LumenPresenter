// Small DOM helpers shared by the console's modules.

export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];

let tt;
/** A short note at the bottom of the console, for `ms` (0 keeps it up until the next one). */
export function toast(msg, ms = 2200) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(tt);
  if (ms) tt = setTimeout(() => t.classList.remove('show'), ms);
}
export const hideToast = () => { clearTimeout(tt); $('#toast').classList.remove('show'); };

/** An error that stays up until it is closed, its words selectable and copyable to report it. Errors that come
 * before it is closed are added to it. */
export function errorBox(title, detail) {
  const box = $('#errBox'), list = $('#errList');
  if (box.hidden) list.textContent = '';
  const item = document.createElement('div'); item.className = 'err-item';
  const h = document.createElement('b'); h.textContent = title;
  const p = document.createElement('div'); p.textContent = detail;
  item.append(h, p); list.append(item);
  box.hidden = false;
  $('#errClose').onclick = () => { box.hidden = true; };
  $('#errCopy').onclick = () => navigator.clipboard.writeText(list.innerText).then(() => toast('Copied'), () => toast('Select the text to copy it'));
}
