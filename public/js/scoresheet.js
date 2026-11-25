// Basketball scoresheet for the broadcast table, modeled on the classic paper
// sheet: season stats on top, each team's players side by side with fouls
// (1–5) and points (1–40) to mark off, and running totals by half.
//
// Before the game it prints with names and season stats filled in. During the
// game it fills itself from the stat keeper, and afterward it's the completed
// sheet: print it or Save as PDF.
//
// Operators open /scoresheet (signed in). Broadcasters get a read-only link,
// /scoresheet#key=<overlay key>, that updates as the game goes.
import {$$, byId, Doc, esc, getSession, onConnection, readable, setText, shade, toast, validImage} from './common.js';
import {lineScore, score as statsScore, teamFouls} from './stats-engine.js';
import {SEASON, gameLines, matchSeason, parseSeasonTable, rosterFor, runningTotals, seasonRows, sheetPlayers, threeMarks} from './scoresheet-data.js';

const PAPER = {letter: {w: 8.5, h: 11}, legal: {w: 8.5, h: 14}, tabloid: {w: 11, h: 17}};
const viewKey = new URLSearchParams(location.hash.slice(1)).get('key') || '';
const viewer = Boolean(viewKey);
const fail = error => toast(error.message || String(error), 'error');
const local = {
  get: (key, fallback) => { try { const v = localStorage.getItem('studio.sheet.' + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set: (key, value) => { try { localStorage.setItem('studio.sheet.' + key, JSON.stringify(value)); } catch {} },
};
const today = () => new Date().toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'});
const opts = {
  paper: local.get('paper', 'letter'), seasonRows: Number(local.get('seasonRows', 5)), fill: local.get('fill', true),
  date: local.get('dateDay', '') === new Date().toDateString() ? local.get('date', today()) : today(),
};
let data = null; // {live, stats, rosters: [roster|null, roster|null]}

// ── Loading ─────────────────────────────────────────────────────────────────
const libraryDoc = viewer ? null : new Doc('library', {onChange: () => refresh(), interval: 6000});
const liveDoc = viewer ? null : new Doc('live', {onChange: () => refresh(), interval: 3000});
const statsDoc = viewer ? null : new Doc('stats', {onChange: () => refresh(), interval: 2500});
function refresh() {
  if (viewer || !libraryDoc.ready || !liveDoc.ready || !statsDoc.ready) return;
  const live = liveDoc.doc;
  data = {live, stats: statsDoc.doc, rosters: live.teams.map(t => rosterFor(t.name, libraryDoc.doc))};
  render();
}

let viewVersion = '';
async function pollViewer() {
  try {
    const response = await fetch('/api/overlay?doc=scoresheet', {cache: 'no-store', headers: {Authorization: 'Bearer ' + viewKey, ...(viewVersion ? {'X-Doc-Version': viewVersion} : {})}});
    if (response.status === 401) throw new Error('This scoresheet link is out of date. Ask for a new one.');
    if (response.ok && response.status !== 204) {
      const packet = await response.json();
      viewVersion = `${packet.session}/${packet.revision}`;
      data = {live: packet.live, stats: packet.stats, rosters: packet.rosters};
      render();
    }
    setConnection(true);
  } catch (error) {
    setConnection(false);
    if (/out of date/.test(error.message)) { showError(error.message); return; }
  }
  setTimeout(pollViewer, 3000);
}

// ── Drawing the sheet ───────────────────────────────────────────────────────
function teamVars(element, team, suffix = '') {
  const color = team?.color || '#333333';
  // Very light team colors would vanish on white paper; darken them.
  const ink = readable(color) !== '#ffffff' ? shade(color, 0.55) : color;
  element.style.setProperty('--c' + suffix, ink);
  element.style.setProperty('--ci' + suffix, readable(ink));
}
const logo = team => (validImage(team.logo) ? `<img src="${esc(team.logo)}" alt=""${team.logoBacking ? ' class="backed"' : ''}>` : '');

function render() {
  if (!data) return;
  const {live, stats, rosters} = data;
  const teams = live.teams;
  const paper = PAPER[opts.paper] || PAPER.letter;
  byId('pageSize').textContent = `@page{size:${paper.w}in ${paper.h}in;margin:0}`;
  const onBasketball = stats.sport === 'basketball';
  const fill = opts.fill && onBasketball && stats.events.length > 0;
  const players = [0, 1].map(side => sheetPlayers(side, {stats, rosters}));
  const lines = fill ? gameLines(stats) : [new Map(), new Map()];
  const running = fill ? runningTotals(stats.events, players) : [[[], []], [[], []]];
  const total = fill ? statsScore('basketball', stats.events) : null;

  const sheet = document.createElement('section');
  sheet.className = 'sheet';
  sheet.style.setProperty('--w', paper.w + 'in');
  sheet.style.setProperty('--h', paper.h + 'in');
  sheet.style.setProperty('--rw', paper.w > 9 ? '2.6in' : '2.05in');

  // Header: title and date, the matchup, and the score by quarter.
  const period = live.games.basketball?.period || '';
  const status = !fill ? '' : /final/i.test(period) ? 'FINAL' : `IN PROGRESS · ${period}`;
  const ls = fill ? lineScore('basketball', stats.events) : {columns: ['1st', '2nd', '3rd', '4th'], rows: [[], []]};
  const head = document.createElement('header');
  head.className = 'ssHead';
  head.innerHTML = `<div class="ssTitle"><b>BB Scoresheet</b><span>${esc(opts.date)}</span>${status ? `<i>${esc(status)}</i>` : ''}</div>
    <div class="ssMatch">${teams.map((t, i) => `<div class="ssTeam" data-side="${i}">${logo(t)}<b>${esc(t.name)}</b>${total ? `<em>${total[i]}</em>` : ''}</div>`).join('<span class="ssVs">vs.</span>')}</div>
    <table class="ssLine"><tr><th></th>${ls.columns.map(c => `<th>${esc(c.replace(/(st|nd|rd|th)$/, ''))}</th>`).join('')}<th>T</th></tr>
    ${[0, 1].map(i => `<tr><td class="k">${esc(teams[i].short)}</td>${ls.columns.map((c, j) => `<td>${fill ? ls.rows[i][j] : ''}</td>`).join('')}<td class="t">${total ? total[i] : ''}</td></tr>`).join('')}</table>`;
  $$('.ssTeam', head).forEach(el => teamVars(el, teams[Number(el.dataset.side)]));
  sheet.append(head);

  const body = document.createElement('div');
  body.className = 'ssBody';
  const main = document.createElement('div');
  main.className = 'ssMainCol';

  // Season stats table.
  const season = [0, 1].map(side => seasonRows(players[side], opts.seasonRows >= 99 ? 0 : opts.seasonRows));
  const seasonCount = opts.seasonRows ? season[0].length + season[1].length : 0;
  if (seasonCount) {
    const table = document.createElement('table');
    table.className = 'season';
    table.innerHTML = `<tr><th class="pl">Season</th>${SEASON.map(([, label]) => `<th>${esc(label)}</th>`).join('')}</tr>` +
      [0, 1].map(side => season[side].map((p, i) => `<tr class="${side ? 'b' : ''}${side && i === 0 && season[0].length ? ' split' : ''}" data-side="${side}"><td class="pl"><span>${esc(p.num)}</span>${esc(p.name)}</td>${
        SEASON.map(([key]) => `<td>${esc(p.season[key] ?? '')}</td>`).join('')}</tr>`).join('')).join('');
    $$('tr[data-side]', table).forEach(tr => teamVars(tr, teams[Number(tr.dataset.side)]));
    main.append(table);
  }

  // Player rows: [A name + fouls][A points][B name + fouls][B points].
  const contentH = paper.h - 0.6 - 0.7 - 0.14 - 0.21;
  const areaH = contentH - (seasonCount ? (seasonCount + 1) * 0.19 + 0.07 : 0) - 0.2;
  const rows = Math.max(players[0].length, players[1].length, Math.min(13, Math.floor(areaH / 0.62)));
  const rh = Math.min(1.05, areaH / rows);
  const grid = document.createElement('div');
  grid.className = 'players';
  grid.style.setProperty('--rows', rows);
  grid.style.setProperty('--rh', rh.toFixed(3) + 'in');
  const maxPts = Math.max(40, ...[0, 1].flatMap(side => [...lines[side].values()].map(l => l.pts)));
  const cells = Math.ceil(maxPts / 10) * 10;
  const html = [];
  [0, 1].forEach(side => html.push(
    `<div class="hd${side ? ' b' : ''}" data-side="${side}"><i></i>${esc(teams[side].short || teams[side].name)} · Player &amp; fouls</div>`,
    `<div class="hd${side ? ' b' : ''}">Points</div>`));
  for (let r = 0; r < rows; r += 1) {
    for (const side of [0, 1]) {
      const p = players[side][r];
      const b = side ? ' b' : '';
      if (!p) { html.push(`<div class="pn${b}" data-side="${side}"><div class="fouls">${[1, 2, 3, 4, 5].map(n => `<u>${n}</u>`).join('')}</div></div>`, `<div class="pts${b}" data-side="${side}">${pointsGrid(cells, 0, new Set())}<div class="statline"></div></div>`); continue; }
      const line = lines[side].get(p.id);
      const pf = line?.pf || 0;
      const parts = String(p.name || '').trim().split(/\s+/);
      const last = parts.length > 1 ? parts.pop() : parts[0] || '';
      const sub = [parts.join(' '), p.cls, p.pos, p.ht].filter(Boolean).map(esc).join(' · ') + (p.say ? ` · <i>${esc(p.say)}</i>` : '');
      html.push(`<div class="pn${b}" data-side="${side}"><div class="pnTop"><span class="pnNum">${esc(p.num)}</span><div class="pnName"><b>${esc(last)}</b><span>${sub}</span></div></div>
        <div class="fouls">${[1, 2, 3, 4, 5].map(n => `<u class="${n <= pf ? (pf >= 5 ? 'out' : 'on') : ''}">${n}</u>`).join('')}${pf >= 5 ? '<small>FOULED OUT</small>' : ''}</div></div>`);
      const marks = line ? threeMarks(stats.events, side, p.id) : new Set();
      const stat = line ? [`<b>${line.pts} pts</b>`, `${line.fgm}-${line.fga} fg`, `${line.tpm}-${line.tpa} 3p`, `${line.ftm}-${line.fta} ft`, `${line.oreb + line.dreb} reb`,
        line.ast && `${line.ast} ast`, line.stl && `${line.stl} stl`, line.blk && `${line.blk} blk`].filter(Boolean).map(x => `<span>${x}</span>`).join('') : '';
      html.push(`<div class="pts${b}" data-side="${side}">${pointsGrid(cells, line?.pts || 0, marks)}<div class="statline">${stat}</div></div>`);
    }
  }
  grid.innerHTML = html.join('');
  $$('[data-side]', grid).forEach(el => teamVars(el, teams[Number(el.dataset.side)]));
  main.append(grid);
  body.append(main);

  // Running totals: each team's score after every basket, by half.
  const run = document.createElement('div');
  run.className = 'running';
  const rr = Math.max(20, Math.floor((contentH - 0.39) / 0.19), ...running.flat().map(list => list.length));
  run.style.setProperty('--rr', rr);
  const fouls = fill ? [['1st', '2nd'], ['3rd', '4th']].map(qs => qs.map(q => teamFouls(stats.events, q)).reduce((a, f) => [a[0] + f[0], a[1] + f[1]], [0, 0])) : null;
  const out = [`<div class="half">1st half</div>`, `<div class="half">2nd half${running[1].some(list => list.some(x => x.ot)) ? ' + OT' : ''}</div>`];
  [0, 1].forEach(half => [0, 1].forEach(side => out.push(`<div class="tm${side ? ' b' : ''}${half === 0 && side === 1 ? ' c2' : ''}${half === 1 && side === 1 ? ' r4' : ''}" data-side="${side}"><i></i>${esc(teams[side].short)}${fouls ? ` <small>TF ${fouls[half][side]}</small>` : ''}</div>`)));
  for (let r = 0; r < rr; r += 1) {
    [0, 1].forEach(half => [0, 1].forEach(side => {
      const entry = running[half][side][r];
      const cls = `${side ? 'b' : ''}${half === 0 && side === 1 ? ' c2' : ''}${half === 1 && side === 1 ? ' r4' : ''}${entry?.ot ? ' ot' : ''}`;
      out.push(`<div class="${cls}">${entry ? `${entry.score}${entry.num ? ` <small>#${esc(entry.num)}</small>` : ''}` : ''}</div>`);
    }));
  }
  run.innerHTML = out.join('');
  $$('[data-side]', run).forEach(el => teamVars(el, teams[Number(el.dataset.side)]));
  body.append(run);
  sheet.append(body);

  sheet.insertAdjacentHTML('beforeend', `<footer class="ssFoot"><span>${esc(teams[0].name)} vs. ${esc(teams[1].name)} · ${esc(opts.date)}</span><span>${fill ? `${stats.events.length} plays from the stat keeper · ` : ''}Broadcast Studio</span></footer>`);
  byId('sheets').replaceChildren(sheet);
  fitZoom();

  // Status line.
  const counts = players.map((list, i) => `${teams[i].short || teams[i].name} ${list.length}`).join(', ');
  const missing = [0, 1].filter(i => !players[i].length).map(i => teams[i].name);
  setText('ssInfo', [
    `Teams on the scorebug. Players: ${counts}.`,
    missing.length ? `No basketball roster for ${missing.join(' or ')}; load the teams on the control panel's Teams tab.` : '',
    !onBasketball ? 'The stat keeper is on football, so the sheet is blank for scoring.' :
      fill ? `Filled from the stat keeper (${stats.events.length} plays). It updates as plays are logged.` :
        opts.fill ? 'No plays logged yet; it fills in as the stat keeper logs the game.' : 'Printing blank for scoring by hand.',
  ].filter(Boolean).join(' '));
  if (!viewer) renderEditor();
}

function pointsGrid(cells, pts, marks) {
  let out = '<div class="grid40">';
  for (let n = 1; n <= cells; n += 1) {
    const cls = [n <= pts && 'hit', n === pts && 'end', marks.has(n) && 'three'].filter(Boolean).join(' ');
    out += `<s${cls ? ` class="${cls}"` : ''}>${n}</s>`;
  }
  return out + '</div>';
}

function fitZoom() {
  const paper = PAPER[opts.paper] || PAPER.letter;
  byId('sheets').style.setProperty('--z', Math.min(1, (innerWidth - 32) / (paper.w * 96)).toFixed(3));
}
addEventListener('resize', fitZoom);

// ── Controls ────────────────────────────────────────────────────────────────
byId('ssDate').value = opts.date;
byId('ssDate').oninput = event => { opts.date = event.target.value; local.set('date', opts.date); local.set('dateDay', new Date().toDateString()); render(); };
byId('ssPaper').value = opts.paper;
byId('ssPaper').onchange = event => { opts.paper = event.target.value; local.set('paper', opts.paper); render(); };
byId('ssSeasonRows').value = String(opts.seasonRows);
byId('ssSeasonRows').onchange = event => { opts.seasonRows = Number(event.target.value); local.set('seasonRows', opts.seasonRows); render(); };
byId('ssFill').checked = opts.fill;
byId('ssFill').onchange = event => { opts.fill = event.target.checked; local.set('fill', opts.fill); render(); };
byId('ssPrint').onclick = () => window.print();
byId('ssLink').onclick = async () => {
  try {
    const session = await getSession();
    const url = `${location.origin}/scoresheet#key=${session.overlayKey}`;
    await navigator.clipboard.writeText(url);
    toast('Broadcaster link copied. It updates live and shows the finished sheet after the game.');
  } catch { toast('Could not copy the link.', 'error'); }
};

// ── Season stats editor (operators) ─────────────────────────────────────────
let editSide = 0;
let editorKey = '';
function editPlayers() {
  const roster = data?.rosters[editSide];
  return roster ? [...roster.players].sort((a, b) => (parseInt(a.num, 10) || 999) - (parseInt(b.num, 10) || 999)) : [];
}
function renderEditor(force = false) {
  const teams = data.live.teams;
  byId('editor').hidden = false;
  setText('edSide0', teams[0].name);
  setText('edSide1', teams[1].name);
  $$('#edSide [data-side]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.side) === editSide)));
  const players = editPlayers();
  const key = JSON.stringify([editSide, teams[editSide].name, players.map(p => p.id)]);
  const typing = byId('edTable').contains(document.activeElement);
  if (!force && key === editorKey) {
    if (typing) return;
    $$('#edTable [data-k]').forEach(input => {
      const p = players.find(x => x.id === input.closest('tr').dataset.id);
      if (p) input.value = p.season?.[input.dataset.k] ?? '';
    });
    return;
  }
  editorKey = key;
  $$('#edTable thead')[0].innerHTML = `<tr><th>Player</th>${SEASON.map(([, label]) => `<th>${esc(label)}</th>`).join('')}</tr>`;
  $$('#edTable tbody')[0].innerHTML = players.length
    ? players.map(p => `<tr data-id="${esc(p.id)}"><td class="who">#${esc(p.num)} ${esc(p.name)}</td>${SEASON.map(([k]) => `<td><input data-k="${k}" maxlength="7" value="${esc(p.season?.[k] ?? '')}" aria-label="${k}"></td>`).join('')}</tr>`).join('')
    : `<tr><td class="muted">No basketball roster saved for ${esc(teams[editSide].name)}. Add one in the control panel's Team builder.</td></tr>`;
  $$('#edTable [data-k]').forEach(input => {
    input.onchange = () => saveSeason(editSide, [{id: input.closest('tr').dataset.id, fields: {[input.dataset.k]: input.value.trim()}}]);
  });
}
byId('edSide').onclick = event => {
  const side = event.target.closest('[data-side]')?.dataset.side;
  if (side === undefined) return;
  editSide = Number(side);
  setText('edResult', '');
  renderEditor(true);
};
function saveSeason(side, updates, clear = false) {
  const name = data.live.teams[side].name;
  return libraryDoc.commit(lib => {
    const roster = (lib.rosters || []).find(r => r.sport === 'basketball' && r.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (!roster) return false;
    if (clear) { roster.players.forEach(p => { delete p.season; }); return; }
    for (const {id, fields} of updates) {
      const player = roster.players.find(p => p.id === id);
      if (!player) continue;
      player.season = {...(player.season || {}), ...fields};
      for (const [k, v] of Object.entries(player.season)) if (v === '') delete player.season[k];
      if (!Object.keys(player.season).length) delete player.season;
    }
  }).then(ok => {
    if (ok) { setText('edSaved', 'Saved'); setTimeout(() => setText('edSaved', ''), 1500); }
    return ok;
  }).catch(fail);
}
byId('edApply').onclick = async () => {
  const rows = parseSeasonTable(byId('edPaste').value);
  if (!rows.length) { toast('No stats table found. Include the header row (#, Name, PPG, …).', 'error'); return; }
  const players = editPlayers();
  const {matched, missed} = matchSeason(rows, players);
  if (!matched.length) { toast('None of those rows matched this roster by number or name.', 'error'); return; }
  const ok = await saveSeason(editSide, matched.map(m => ({id: m.player.id, fields: m.fields})));
  if (ok) {
    byId('edPaste').value = '';
    setText('edResult', `Updated ${matched.length} player${matched.length === 1 ? '' : 's'}.${missed.length ? ` Not on the roster: ${missed.slice(0, 6).join(', ')}${missed.length > 6 ? '…' : ''}` : ''}`);
    renderEditor(true);
  }
};
byId('edClear').onclick = async () => {
  if (!confirm(`Clear season stats for ${data.live.teams[editSide].name}?`)) return;
  if (await saveSeason(editSide, [], true)) renderEditor(true);
};

// ── Start ───────────────────────────────────────────────────────────────────
function setConnection(online) {
  const element = byId('connection');
  element.textContent = online ? (viewer ? 'Live' : 'Connected') : 'Offline — retrying';
  element.classList.toggle('online', online);
}
function showError(message) {
  const box = byId('startupError');
  box.hidden = false;
  box.textContent = message;
}

(async () => {
  try {
    if (viewer) {
      document.body.classList.add('viewer');
      setText('modeLabel', 'BROADCASTER VIEW · UPDATES LIVE');
      byId('ssLink').hidden = true;
      byId('backLink').hidden = true;
      byId('app').hidden = false;
      pollViewer();
      return;
    }
    onConnection(setConnection);
    if (!await getSession()) return;
    await Promise.all([libraryDoc.start(), liveDoc.start(), statsDoc.start()]);
    byId('app').hidden = false;
    refresh();
  } catch (error) {
    showError(error.message);
  }
})();
