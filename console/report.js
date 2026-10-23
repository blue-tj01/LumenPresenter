// @ts-check
// The CCLI usage report dialog: the songs shown between two dates, to copy into CCLI's site or save as a CSV file.
import { $, toast } from './dom.js';
import { state } from './library.js';
import { isoDate } from './services.js';
import { reportCsv, reportText, usageReport } from './usage.js';

const shortDate = day => new Date(Date.parse(day + 'T00:00:00Z'))
  .toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

let rows = [];
function renderReport() {
  const from = $('#usageFrom').value, to = $('#usageTo').value;
  rows = usageReport(state.db.usage, from, to);
  const table = $('#usageTable'); table.innerHTML = '';
  const head = table.createTHead().insertRow();
  for (const [h, cls] of [['Title'], ['CCLI Song #'], ['Writers'], ['Times used', 'n'], ['Dates']]) {
    const th = document.createElement('th'); th.textContent = h; if (cls) th.className = cls; head.appendChild(th);
  }
  const body = table.createTBody();
  for (const s of rows) {
    const tr = body.insertRow();
    for (const [v, cls] of [[s.name], [s.ccli], [s.author], [String(s.count), 'n'], [s.days.map(shortDate).join(', ')]]) {
      const td = tr.insertCell(); td.textContent = v; if (cls) td.className = cls;
    }
  }
  if (!rows.length) {
    const td = body.insertRow().insertCell(); td.colSpan = 5; td.className = 'none';
    td.textContent = 'No songs with a CCLI song number were shown in these dates.';
  }
  const uses = rows.reduce((n, s) => n + s.count, 0);
  $('#usageSum').textContent = rows.length ? `${rows.length} song${rows.length === 1 ? '' : 's'} · ${uses} use${uses === 1 ? '' : 's'}` : '';
  $('#usageCopy').disabled = $('#usageCsv').disabled = !rows.length;
}

function openReport() {
  // CCLI's reporting periods run six months, so that is where the dates start.
  const today = new Date();
  if (!$('#usageTo').value) $('#usageTo').value = isoDate(today);
  if (!$('#usageFrom').value) $('#usageFrom').value = isoDate(new Date(today.getFullYear(), today.getMonth() - 6, today.getDate()));
  renderReport();
  $('#usageDialog').hidden = false;
}

export function setupReport() {
  $('#btnUsage').onclick = openReport;
  $('#usageFrom').onchange = $('#usageTo').onchange = renderReport;
  $('#usageClose').onclick = () => { $('#usageDialog').hidden = true; };
  $('#usageDialog').onkeydown = e => { e.stopPropagation(); if (e.key === 'Escape') $('#usageDialog').hidden = true; };
  $('#usageCopy').onclick = () => navigator.clipboard.writeText(reportText(rows))
    .then(() => toast('Copied: paste it into a spreadsheet or CCLI\'s reporting page'), () => toast('Could not copy'));
  $('#usageCsv').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([reportCsv(rows)], { type: 'text/csv' }));
    a.download = `ccli-usage-${$('#usageFrom').value}-to-${$('#usageTo').value}.csv`;
    a.click();
  };
}
