// @ts-check
// Questions asked in the console's own dialog, in place of the browser's confirm(): the same look as the rest of
// Lumen, the safe answer picked by default for anything that can't be taken back, and nothing that a stray Enter
// or space bar press in the middle of a service can say yes to by accident.

/** Ask a question; resolves true for yes. `ok` names the yes button, `danger` marks it as one that loses
 * something (and focuses Cancel instead), and `typed` is a word to type before yes can be pressed. */
export function ask(message, { title = '', ok = 'OK', cancel = 'Cancel', danger = false, typed = '' } = {}) {
  return new Promise(resolve => {
    const back = document.createElement('div'); back.className = 'modal ask';
    const card = document.createElement('form'); card.className = 'modal-card ask-card';
    card.setAttribute('role', 'alertdialog'); card.setAttribute('aria-modal', 'true');
    const h = document.createElement('b'); h.className = 'ask-title'; h.textContent = title; h.id = 'askTitle';
    const p = document.createElement('p'); p.className = 'ask-text'; p.textContent = message; p.id = 'askText';
    card.setAttribute('aria-labelledby', title ? 'askTitle' : 'askText'); card.setAttribute('aria-describedby', 'askText');
    const input = document.createElement('input'); input.className = 'ask-typed'; input.autocomplete = 'off';
    input.setAttribute('aria-label', `Type ${typed} to confirm`); input.placeholder = typed;
    const row = document.createElement('div'); row.className = 'ask-actions';
    const no = document.createElement('button'); no.type = 'button'; no.className = 'btn ghost'; no.textContent = cancel;
    const yes = document.createElement('button'); yes.type = 'submit'; yes.className = 'btn ' + (danger ? 'danger-solid' : 'primary'); yes.textContent = ok;
    row.append(no, yes);
    card.append(...(title ? [h] : []), p);
    if (typed) {
      const label = document.createElement('label'); label.className = 'ask-label';
      label.append(`Type ${typed} to confirm`, input); card.append(label);
      yes.disabled = true;
      input.oninput = () => { yes.disabled = input.value.trim().toUpperCase() !== typed.toUpperCase(); };
    }
    card.append(row); back.append(card);
    const was = /** @type {HTMLElement | null} */ (document.activeElement);
    const done = v => { back.remove(); was?.focus?.(); resolve(v); };
    no.onclick = () => done(false);
    back.onmousedown = e => { if (e.target === back) done(false); };
    card.onsubmit = e => { e.preventDefault(); if (!yes.disabled) done(true); };
    // Keys stay in the dialog, so arrows and F-keys don't move the slides behind it.
    back.onkeydown = e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
      if (e.key === 'Tab') { // keep focus inside
        /** @type {HTMLElement[]} */
        const f = [...card.querySelectorAll('button:not(:disabled), input')].map(el => /** @type {HTMLElement} */ (el));
        const i = f.findIndex(el => el === document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f.at(-1).focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.body.append(back);
    (typed ? input : danger ? no : yes).focus();
  });
}
