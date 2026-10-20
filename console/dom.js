// Small DOM helpers shared by the console's modules.

export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];

let tt;
export function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2200); }
