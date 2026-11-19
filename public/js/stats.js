import {$, $$, byId, clockText, copy, Doc, download, esc, getSession, onConnection, PHOTO_X, PHOTO_Y, photoPosition, readImage, remaining, serverNow, setText, toast, uid, validImage} from './common.js';
import {boxScore, compareRows, describe, lineScore, parseRoster, points, score, statLine, teamFouls} from './stats-engine.js';
import {defaultStats} from './defaults.js';

const statsDoc = new Doc('stats', {onChange: () => render(), interval: 2000});
const liveDoc = new Doc('live', {onChange: () => renderSync(), interval: 1000});
const libraryDoc = new Doc('library', {onChange: () => renderRosters(), interval: 8000});
const S = () => statsDoc.doc;
const L = () => liveDoc.doc;
const fail = error => toast(error.message || String(error), 'error');
const other = team => 1 - team;
let selected = null; // {team, id}

const local = {
  get: (key, fallback) => { try { const v = localStorage.getItem('studio.' + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set: (key, value) => { try { localStorage.setItem('studio.' + key, JSON.stringify(value)); } catch {} },
};

function confirmBox(title, text, ok = 'OK') {
  const dialog = byId('confirmDialog');
  setText('confirmTitle', title); setText('confirmText', text); setText('confirmOk', ok);
  dialog.showModal();
  return new Promise(resolve => { dialog.onclose = () => resolve(dialog.returnValue === 'ok'); });
}

// ── Tabs ────────────────────────────────────────────────────────────────────
function setTab(tab) {
  $$('nav.tabs [data-tab]').forEach(b => { if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  ['live', 'rosters', 'box', 'pbp'].forEach(name => { byId('tab-' + name).hidden = name !== tab; });
  local.set('statsTab', tab);
  render();
}
$$('nav.tabs [data-tab]').forEach(b => { b.onclick = () => setTab(b.dataset.tab); });

// ── Time stamps from the scorebug ───────────────────────────────────────────
const linked = () => liveDoc.ready && statsDoc.ready && L().sport === S().sport;
function stamp() {
  if (linked()) {
    const g = L().games[S().sport];
    return {period: g.period === 'HALF' ? '2nd' : g.period, clock: remaining(g.game, serverNow())};
  }
  return {period: byId('ownPeriod').value || '1st', clock: null};
}
const teamName = i => (liveDoc.ready ? L().teams[i].name : ['Left', 'Right'][i]);
const teamShort = i => (liveDoc.ready ? L().teams[i].short : ['L', 'R'][i]);

function renderSync() {
  if (!liveDoc.ready || !statsDoc.ready) return;
  const chip = byId('syncChip');
  const same = linked();
  const g = L().games[S().sport];
  chip.textContent = same ? `SYNCED · ${g.period} ${clockText(remaining(g.game, serverNow()), S().sport === 'basketball')}` : `SCOREBUG ON ${L().sport.toUpperCase()}`;
  chip.classList.toggle('active', same);
  byId('ownPeriod').hidden = same;
  byId('timeBox').hidden = !same;
  if (same) setText('timeBox', `${g.period} · ${clockText(remaining(g.game, serverNow()), S().sport === 'basketball')}`);
  [0, 1].forEach(i => { setText('sbName' + i, L().teams[i].short); });
  // Score check
  const s = score(S().sport, S().events);
  const bar = byId('mismatch');
  if (!S().events.length) { bar.hidden = true; return; }
  if (!same) {
    bar.hidden = false;
    setText('mismatchText', `The scorebug is on ${L().sport}; stats are ${S().sport}. Clock and score are not linked.`);
    byId('setBug').hidden = true; byId('switchBug').hidden = false;
    return;
  }
  const differs = s[0] !== g.score[0] || s[1] !== g.score[1];
  bar.hidden = !differs || sending;
  byId('setBug').hidden = false; byId('switchBug').hidden = true;
  if (differs) setText('mismatchText', `Scorebug shows ${g.score[0]}–${g.score[1]}, stats have ${s[0]}–${s[1]}.`);
}
setInterval(() => { if (linked()) renderSync(); }, 500);

let sending = false;
async function sendToBug(force = false) {
  if (!linked() || (!force && !byId('autoSend').checked) || !S().events.length) return;
  const sport = S().sport;
  const s = score(sport, S().events);
  const trackFouls = sport === 'basketball' && S().events.some(e => e.type === 'pf');
  sending = true;
  try {
    await liveDoc.commit(d => {
      const g = d.games[sport];
      if (d.sport !== sport) return false;
      const fouls = trackFouls ? teamFouls(S().events, g.period) : g.fouls;
      if (g.score[0] === s[0] && g.score[1] === s[1] && (!trackFouls || (g.fouls[0] === fouls[0] && g.fouls[1] === fouls[1]))) return false;
      g.score = s;
      if (trackFouls) g.fouls = fouls;
    });
  } catch (error) { fail(error); }
  finally { sending = false; renderSync(); }
}
byId('setBug').onclick = () => sendToBug(true);
byId('switchBug').onclick = () => liveDoc.commit(d => { d.sport = S().sport; }).catch(fail);
byId('autoSend').onchange = event => statsDoc.commit(s => { s.autoSend = event.target.checked; }).catch(fail);

// ── Adding plays ────────────────────────────────────────────────────────────
async function addEvents(...events) {
  const time = stamp();
  const stamped = events.map(e => ({id: uid(), ...time, at: Date.now(), ...e}));
  try {
    await statsDoc.commit(s => { s.events.push(...stamped); if (!s.startedAt) s.startedAt = Date.now(); });
    const pts = stamped.reduce((n, e) => n + points(S().sport, e), 0);
    toast(describe(S().sport, stamped[0], S()) + (pts ? `  (+${pts})` : ''));
    selected = null;
    render();
    sendToBug();
  } catch (error) { fail(error); }
}

// Dialog with fields; resolves to the values or null.
function ask(title, fields, {autoSubmit = false} = {}) {
  const dialog = byId('playDialog');
  setText('playTitle', title);
  const box = byId('playFields');
  const values = {};
  box.replaceChildren(...fields.map(f => {
    const wrap = document.createElement('div');
    values[f.key] = f.value ?? (f.kind === 'toggle' ? false : f.kind === 'players' ? null : f.kind === 'yards' ? 0 : f.choices?.[0]?.[0]);
    if (f.kind === 'players' || f.kind === 'choice') {
      const choices = f.kind === 'players'
        ? [...(f.none ? [[null, f.none]] : []), ...S().teams[f.team].players.filter(p => p.id !== f.exclude).map(p => [p.id, `#${p.num} ${p.name}`])]
        : f.choices;
      wrap.innerHTML = `<span class="label">${esc(f.label)}</span><div class="chips" style="margin-top:5px"></div>`;
      const chips = $('.chips', wrap);
      choices.forEach(([value, label]) => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = label;
        b.setAttribute('aria-pressed', values[f.key] === value);
        b.onclick = () => {
          values[f.key] = value;
          $$('button', chips).forEach(x => x.setAttribute('aria-pressed', x === b));
          if (autoSubmit) { dialog.returnValue = 'ok'; dialog.close('ok'); }
        };
        chips.append(b);
      });
      if (f.kind === 'players' && !choices.length) chips.innerHTML = '<span class="muted">No roster for this team. Add players in Rosters.</span>';
    } else if (f.kind === 'yards') {
      wrap.innerHTML = `<span class="label">${esc(f.label)}</span><div class="yardsRow" style="margin-top:5px"><button type="button" data-d="-1">−</button><input type="number" inputmode="numeric" value="${values[f.key]}" min="-99" max="110"><button type="button" data-d="1">+</button>${(f.quick || []).map(q => `<button type="button" data-q="${q}">${q}</button>`).join('')}</div>`;
      const input = $('input', wrap);
      input.oninput = () => { values[f.key] = Number(input.value) || 0; };
      $$('[data-d]', wrap).forEach(b => { b.onclick = () => { input.value = (Number(input.value) || 0) + Number(b.dataset.d); input.oninput(); }; });
      $$('[data-q]', wrap).forEach(b => { b.onclick = () => { input.value = b.dataset.q; input.oninput(); }; });
      setTimeout(() => { input.focus(); input.select(); }, 30);
    } else if (f.kind === 'toggle') {
      wrap.innerHTML = `<label class="check" style="font-size:15px"><input type="checkbox" ${values[f.key] ? 'checked' : ''}> ${esc(f.label)}</label>`;
      $('input', wrap).onchange = event => { values[f.key] = event.target.checked; };
    } else if (f.kind === 'text') {
      wrap.innerHTML = `<label>${esc(f.label)}<input maxlength="40"></label>`;
      $('input', wrap).oninput = event => { values[f.key] = event.target.value; };
    }
    return wrap;
  }));
  byId('playSave').hidden = autoSubmit;
  dialog.onkeydown = event => {
    if (event.key === 'Enter' && event.target.tagName === 'INPUT' && event.target.type !== 'checkbox') { event.preventDefault(); dialog.close('ok'); }
  };
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise(resolve => { dialog.onclose = () => resolve(dialog.returnValue === 'ok' ? values : null); });
}

const need = () => { if (!selected) { toast('Tap a player first.', 'error'); return false; } return true; };
const sel = () => ({team: selected.team, player: selected.id});

const FOOTBALL = [
  ['Offense', [
    ['Pass complete', 'make', async () => {
      const v = await ask('Pass complete', [{kind: 'players', key: 'receiver', team: selected.team, exclude: selected.id, label: 'Receiver', none: 'Unknown'},
        {kind: 'yards', key: 'yards', label: 'Yards', quick: [5, 10, 15, 20, 30]}, {kind: 'toggle', key: 'td', label: 'Touchdown'}]);
      if (v) addEvents({type: 'pass', ...sel(), result: 'complete', receiver: v.receiver, yards: v.yards, td: v.td});
    }],
    ['Incomplete', 'miss', () => addEvents({type: 'pass', ...sel(), result: 'incomplete'})],
    ['Intercepted', 'miss', async () => {
      const v = await ask('Interception', [{kind: 'players', key: 'defender', team: other(selected.team), label: 'Intercepted by', none: 'Unknown'},
        {kind: 'yards', key: 'yards', label: 'Return yards', quick: [0, 10, 20]}, {kind: 'toggle', key: 'td', label: 'Returned for a touchdown'}]);
      if (!v) return;
      const events = [{type: 'pass', ...sel(), result: 'int', defender: v.defender}];
      if (v.defender && (v.yards || v.td)) events.push({type: 'ret', team: other(selected.team), player: v.defender, kind: 'int', yards: v.yards, td: v.td});
      else if (v.td) events.push({type: 'ret', team: other(selected.team), player: null, kind: 'int', yards: v.yards, td: true});
      addEvents(...events);
    }],
    ['Rush', 'make', async () => {
      const v = await ask('Rush', [{kind: 'yards', key: 'yards', label: 'Yards (negative for a loss)', quick: [0, 3, 5, 10]}, {kind: 'toggle', key: 'td', label: 'Touchdown'}]);
      if (v) addEvents({type: 'rush', ...sel(), yards: v.yards, td: v.td});
    }],
    ['Sacked', 'miss', async () => {
      const v = await ask('Sack', [{kind: 'yards', key: 'yards', label: 'Yards lost', value: 5, quick: [3, 5, 8, 10]}, {kind: 'players', key: 'defender', team: other(selected.team), label: 'Sacked by', none: 'Unknown'}]);
      if (v) addEvents({type: 'sack', ...sel(), yards: Math.abs(v.yards), defender: v.defender});
    }],
    ['Fumble', 'miss', async () => {
      const v = await ask('Fumble', [{kind: 'choice', key: 'lost', label: 'Result', choices: [[true, 'Lost'], [false, 'Recovered by offense']]},
        {kind: 'players', key: 'recoveredBy', team: other(selected.team), label: 'Recovered by (if lost)', none: 'Unknown'}]);
      if (v) addEvents({type: 'fumble', ...sel(), lost: v.lost, recoveredBy: v.lost ? v.recoveredBy : null});
    }],
  ]],
  ['Defense', [['Tackle', '', () => addEvents({type: 'tackle', ...sel()})]]],
  ['Kicking', [
    ['Field goal', '', async () => {
      const v = await ask('Field goal', [{kind: 'yards', key: 'yards', label: 'Distance', value: 30, quick: [20, 25, 30, 35, 40]}, {kind: 'choice', key: 'good', label: 'Result', choices: [[true, 'Good'], [false, 'No good']]}]);
      if (v) addEvents({type: 'fg', ...sel(), yards: v.yards, good: v.good});
    }],
    ['XP good', 'make', () => addEvents({type: 'pat', ...sel(), kind: 'kick', good: true})],
    ['XP missed', 'miss', () => addEvents({type: 'pat', ...sel(), kind: 'kick', good: false})],
    ['2-pt try', '', async () => {
      const v = await ask('Two-point try', [{kind: 'choice', key: 'kind', label: 'Play', choices: [['run', 'Run'], ['pass', 'Pass']]}, {kind: 'choice', key: 'good', label: 'Result', choices: [[true, 'Good'], [false, 'No good']]}]);
      if (v) addEvents({type: 'pat', ...sel(), kind: v.kind, good: v.good});
    }],
    ['Punt', '', async () => {
      const v = await ask('Punt', [{kind: 'yards', key: 'yards', label: 'Yards', value: 35, quick: [30, 35, 40, 45]}]);
      if (v) addEvents({type: 'punt', ...sel(), yards: v.yards});
    }],
    ['Return', '', async () => {
      const v = await ask('Return', [{kind: 'choice', key: 'kind', label: 'Type', choices: [['kick', 'Kickoff'], ['punt', 'Punt'], ['int', 'Interception'], ['fumble', 'Fumble']]},
        {kind: 'yards', key: 'yards', label: 'Yards', quick: [0, 10, 20, 30]}, {kind: 'toggle', key: 'td', label: 'Touchdown'}]);
      if (v) addEvents({type: 'ret', ...sel(), kind: v.kind, yards: v.yards, td: v.td});
    }],
  ]],
];

const assist = async three => {
  const v = await ask(`Made ${three ? '3' : '2'} · assist?`, [{kind: 'players', key: 'ast', team: selected.team, exclude: selected.id, label: 'Assisted by', none: 'No assist'}], {autoSubmit: true});
  if (v) addEvents({type: 'fg', ...sel(), three, made: true, ast: v.ast});
};
const BASKETBALL = [
  ['Shots', [
    ['Made 2', 'make', () => assist(false)], ['Missed 2', 'miss', () => addEvents({type: 'fg', ...sel(), three: false, made: false})],
    ['Made 3', 'make', () => assist(true)], ['Missed 3', 'miss', () => addEvents({type: 'fg', ...sel(), three: true, made: false})],
    ['FT made', 'make', () => addEvents({type: 'ft', ...sel(), made: true})], ['FT missed', 'miss', () => addEvents({type: 'ft', ...sel(), made: false})],
  ]],
  ['Other', [
    ['Off. rebound', '', () => addEvents({type: 'reb', ...sel(), off: true})], ['Def. rebound', '', () => addEvents({type: 'reb', ...sel(), off: false})],
    ['Steal', '', () => addEvents({type: 'stl', ...sel()})], ['Block', '', () => addEvents({type: 'blk', ...sel()})],
    ['Turnover', 'miss', () => addEvents({type: 'to', ...sel()})], ['Foul', 'miss', () => addEvents({type: 'pf', ...sel()})],
  ]],
];

async function adjust(team) {
  const v = await ask(`Adjust ${teamName(team)} score`, [{kind: 'yards', key: 'points', label: 'Points (negative to take away)', value: 1, quick: [-1, 1, 2, 3, 6]}, {kind: 'text', key: 'note', label: 'Note (optional)'}]);
  if (v && v.points) addEvents({type: 'adj', team, player: null, points: v.points, note: (v.note || '').slice(0, 40)});
}
const teamActions = {
  football: [['Safety +2', team => addEvents({type: 'safety', team, player: null})], ['± Score', adjust]],
  basketball: [['Team rebound', team => addEvents({type: 'reb', team, player: null, off: false})], ['Team turnover', team => addEvents({type: 'to', team, player: null})],
    ['Team foul', team => addEvents({type: 'pf', team, player: null})], ['± Score', adjust]],
};

function renderLive() {
  const sport = S().sport;
  [0, 1].forEach(team => {
    const side = byId('side' + team);
    if (liveDoc.ready) side.style.setProperty('--team', L().teams[team].color);
    const players = S().teams[team].players;
    side.innerHTML = `<h2><span>${esc(teamName(team))}</span><span class="readout" style="font-size:30px">${score(sport, S().events)[team]}</span></h2>
      <div class="players">${players.length ? players.map(p => `<button type="button" class="player ${selected?.id === p.id ? 'sel' : ''}" data-id="${esc(p.id)}"><b>${esc(p.num)}</b><span>${esc(p.name)}<small>${esc(p.pos || '')}</small></span></button>`).join('') : '<p class="muted">No roster yet. Add players in the Rosters tab.</p>'}</div>
      <div class="teamActs">${teamActions[sport].map(([label], i) => `<button type="button" data-team-act="${i}">${esc(label)}</button>`).join('')}</div>`;
    $$('.player', side).forEach(b => {
      b.onclick = () => { selected = selected?.id === b.dataset.id ? null : {team, id: b.dataset.id}; renderLive(); };
    });
    $$('[data-team-act]', side).forEach(b => { b.onclick = () => teamActions[sport][Number(b.dataset.teamAct)][1](team); });
  });
  const pick = selected && S().teams[selected.team].players.find(p => p.id === selected.id);
  if (selected && !pick) selected = null;
  const label = byId('selected');
  label.classList.toggle('on', Boolean(pick));
  label.textContent = pick ? `${teamShort(selected.team)} · #${pick.num} ${pick.name}` : 'Tap a player, then an action';
  const groups = sport === 'football' ? FOOTBALL : BASKETBALL;
  byId('actions').innerHTML = groups.map(([group, actions], g) => `<div class="groupLabel">${esc(group)}</div>${actions.map(([name, cls], a) => `<button type="button" class="${cls}" data-g="${g}" data-a="${a}" ${pick ? '' : 'disabled'}>${esc(name)}</button>`).join('')}`).join('');
  $$('#actions [data-a]').forEach(b => { b.onclick = () => { if (need()) groups[Number(b.dataset.g)][1][Number(b.dataset.a)][2](); }; });
  const recent = S().events.slice(-5).reverse();
  byId('recent').innerHTML = recent.length ? '<span class="label">Last plays</span>' + recent.map(e => `<div><span>${esc(e.period || '')}</span><b>${esc(describe(sport, e, S()))}</b></div>`).join('') : '';
}

byId('undo').onclick = async () => {
  const last = S().events.at(-1);
  if (!last) return;
  try {
    await statsDoc.commit(s => { if (s.events.at(-1)?.id !== last.id) return false; s.events.pop(); });
    toast('Undid: ' + describe(S().sport, last, S()));
    sendToBug();
  } catch (error) { fail(error); }
};
addEventListener('keydown', event => {
  if (event.target.closest('input, textarea, select, dialog')) return;
  if ((event.key === 'z' && (event.metaKey || event.ctrlKey)) || event.key === 'u') { event.preventDefault(); byId('undo').click(); }
  if (event.key === 'Escape') { selected = null; renderLive(); }
});

// ── Rosters ─────────────────────────────────────────────────────────────────
const photos = new Map();
async function photo(ref) {
  if (!ref) return '';
  if (validImage(ref)) return ref;
  if (photos.has(ref)) return photos.get(ref);
  photos.set(ref, '');
  try {
    const response = await fetch('/api/doc?key=' + encodeURIComponent(ref));
    if (response.ok) photos.set(ref, (await response.json()).doc.data);
  } catch {}
  return photos.get(ref);
}

async function pdfText(file) {
  const pdfjs = await import('/vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';
  const pdf = await pdfjs.getDocument({data: new Uint8Array(await file.arrayBuffer())}).promise;
  const lines = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    const rows = new Map();
    for (const item of content.items) {
      if (!item.str?.trim()) continue;
      const y = Math.round(item.transform[5] / 3);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push([item.transform[4], item.str.trim()]);
    }
    [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, items]) => lines.push(items.sort((a, b) => a[0] - b[0]).map(i => i[1]).join(' ')));
  }
  if (!lines.length) throw new Error('No text found in that PDF. Scanned PDFs are not supported; paste the roster instead.');
  return lines.join('\n');
}

function addPlayers(team, list) {
  if (!list.length) { toast('No players found in that text.', 'error'); return; }
  statsDoc.commit(s => {
    const roster = s.teams[team].players;
    for (const p of list) {
      const existing = p.num && roster.find(x => x.num === p.num);
      if (existing) Object.assign(existing, {name: p.name, pos: p.pos || existing.pos, cls: p.cls || existing.cls});
      else roster.push({id: uid(), num: p.num || '', name: p.name.slice(0, 40), pos: (p.pos || '').slice(0, 6), cls: (p.cls || '').slice(0, 10), photo: ''});
    }
  }).then(() => toast(`${list.length} players added to ${teamName(team)}`)).catch(fail);
}

let rostersKey = '';
function renderRosters(force = false) {
  if (!statsDoc.ready || byId('tab-rosters').hidden) return;
  const key = JSON.stringify([S().teams, S().sport, liveDoc.ready && L().teams.map(t => t.name), (libraryDoc.doc?.rosters || []).map(r => r.id)]);
  if (!force && key === rostersKey) return;
  if (!force && document.activeElement?.closest('#rosterEditors')) return;
  rostersKey = key;
  const library = libraryDoc.doc?.rosters || [];
  byId('rosterEditors').replaceChildren(...[0, 1].map(team => {
    const card = document.createElement('section');
    card.className = 'card';
    const players = S().teams[team].players;
    const saved = library.filter(r => r.sport === S().sport);
    card.innerHTML = `<header><h2>${esc(teamName(team))} <span class="muted">${players.length} players</span></h2>
        <div class="row"><select data-lib>${saved.length ? saved.map(r => `<option value="${esc(r.id)}">${esc(r.name)} (${r.players.length})</option>`).join('') : '<option value="">No saved rosters</option>'}</select><button type="button" data-load>Load</button><button type="button" data-save>Save roster</button></div></header>
      <label>Paste a roster (one player per line: "12 John Smith QB Sr", or CSV with a header)<textarea data-paste placeholder="7 Marcus Hill QB Sr&#10;1 Dee Carter WR Jr"></textarea></label>
      <div class="row" style="margin-top:8px"><button type="button" class="primary" data-add>Add pasted players</button><label class="ghost" style="cursor:pointer">Import PDF or CSV…<input type="file" data-file accept=".pdf,.csv,.txt,application/pdf,text/csv,text/plain" hidden></label><button type="button" data-one>+ Add one</button><button type="button" class="ghost" data-clear>Clear roster</button></div>
      <div class="rosterList">${players.map(p => `<div class="rosterRow" data-id="${esc(p.id)}">${p.photo ? `<button type="button" class="thumb" title="Photo and alignment" data-thumb></button>` : `<label class="thumb" title="Add photo">＋<input type="file" accept="image/*" hidden data-photo></label>`}
        <input data-k="num" value="${esc(p.num)}" maxlength="3" placeholder="#"><input data-k="name" value="${esc(p.name)}" maxlength="40" placeholder="Name"><input data-k="pos" value="${esc(p.pos || '')}" maxlength="6" placeholder="Pos"><input data-k="cls" value="${esc(p.cls || '')}" maxlength="10" placeholder="Yr"><button type="button" class="ghost" data-del aria-label="Remove">✕</button></div>`).join('')}</div>`;
    $('[data-add]', card).onclick = () => addPlayers(team, parseRoster($('[data-paste]', card).value));
    $('[data-one]', card).onclick = () => statsDoc.commit(s => { s.teams[team].players.push({id: uid(), num: '', name: 'New player', pos: '', cls: '', photo: ''}); }).then(() => renderRosters(true)).catch(fail);
    $('[data-clear]', card).onclick = async () => {
      if (await confirmBox(`Clear ${teamName(team)} roster?`, 'Plays already logged for these players will show as "Unknown player".', 'Clear')) {
        statsDoc.commit(s => { s.teams[team].players = []; }).catch(fail);
      }
    };
    $('[data-file]', card).onchange = async event => {
      const file = event.target.files[0];
      try {
        const text = /pdf$/i.test(file.name) || file.type === 'application/pdf' ? await pdfText(file) : await file.text();
        addPlayers(team, parseRoster(text));
      } catch (error) { fail(error); }
      event.target.value = '';
    };
    $('[data-save]', card).onclick = () => {
      const name = teamName(team);
      libraryDoc.commit(lib => {
        lib.rosters = lib.rosters || [];
        const existing = lib.rosters.find(r => r.name === name && r.sport === S().sport);
        const roster = copy(S().teams[team].players);
        if (existing) existing.players = roster; else lib.rosters.push({id: uid(), name, sport: S().sport, players: roster});
      }).then(() => toast(`${name} ${S().sport} roster saved`)).catch(fail);
    };
    $('[data-load]', card).onclick = () => {
      const roster = library.find(r => r.id === $('[data-lib]', card).value);
      if (roster) statsDoc.commit(s => { s.teams[team].players = copy(roster.players); }).then(() => renderRosters(true)).catch(fail);
    };
    $$('.rosterRow', card).forEach(row => {
      const id = row.dataset.id;
      const player = players.find(p => p.id === id);
      if (player.photo) {
        photo(player.photo).then(src => {
          if (!src) return;
          const img = document.createElement('img');
          img.src = src; img.alt = ''; img.style.objectPosition = photoPosition(player.photoPos);
          $('.thumb', row).replaceChildren(img);
        });
        $('[data-thumb]', row).onclick = () => openPhoto(team, id);
      } else bindPhoto(row, team, id);
      $$('[data-k]', row).forEach(input => {
        input.onchange = () => statsDoc.commit(s => { const p = s.teams[team].players.find(x => x.id === id); if (p) p[input.dataset.k] = input.value.trim(); }).catch(fail);
      });
      $('[data-del]', row).onclick = () => statsDoc.commit(s => { s.teams[team].players = s.teams[team].players.filter(x => x.id !== id); }).then(() => renderRosters(true)).catch(fail);
    });
    return card;
  }));
}
// Saves a new photo for a player. The whole photo is kept (only shrunk), so
// the square crop can be moved later with the alignment choices.
async function savePhoto(file, team, id) {
  const data = await readImage(file, {maxWidth: 420, maxHeight: 420, type: 'image/jpeg', quality: 0.84});
  const key = 'photo:' + uid();
  const doc = new Doc(key);
  doc.packet = {session: statsDoc.packet.session, revision: 0, doc: {}};
  await doc.commit(d => { d.data = data; });
  photos.set(key, data);
  await statsDoc.commit(s => { const p = s.teams[team].players.find(x => x.id === id); if (p) { p.photo = key; p.photoPos = 'center top'; } });
  renderRosters(true);
}
function bindPhoto(row, team, id) {
  $('[data-photo]', row).onchange = async event => {
    try {
      await savePhoto(event.target.files[0], team, id);
      openPhoto(team, id);
    } catch (error) { fail(error); }
  };
}

let photoFor = null; // {team, id} while the photo window is open
const photoPlayer = () => photoFor && S().teams[photoFor.team].players.find(p => p.id === photoFor.id);
async function openPhoto(team, id) {
  photoFor = {team, id};
  const player = photoPlayer();
  if (!player) return;
  setText('photoTitle', `${player.num ? '#' + player.num + ' ' : ''}${player.name}`);
  const [x, y] = photoPosition(player.photoPos).split(' ');
  byId('photoX').replaceChildren(...PHOTO_X.map(([value, label]) => new Option(label, value)));
  byId('photoY').replaceChildren(...PHOTO_Y.map(([value, label]) => new Option(label, value)));
  byId('photoX').value = x;
  byId('photoY').value = y;
  const img = byId('photoImg');
  img.style.objectPosition = `${x} ${y}`;
  img.src = (await photo(player.photo)) || '';
  if (!byId('photoDialog').open) byId('photoDialog').showModal();
}
['photoX', 'photoY'].forEach(name => {
  byId(name).onchange = () => {
    const pos = `${byId('photoX').value} ${byId('photoY').value}`;
    byId('photoImg').style.objectPosition = pos;
    const {team, id} = photoFor;
    statsDoc.commit(s => { const p = s.teams[team].players.find(x => x.id === id); if (p) p.photoPos = pos; }).then(() => renderRosters(true)).catch(fail);
  };
});
byId('photoReplace').onchange = async event => {
  const {team, id} = photoFor;
  try { await savePhoto(event.target.files[0], team, id); openPhoto(team, id); } catch (error) { fail(error); }
  event.target.value = '';
};
byId('photoRemove').onclick = () => {
  const {team, id} = photoFor;
  byId('photoDialog').close();
  statsDoc.commit(s => { const p = s.teams[team].players.find(x => x.id === id); if (p) { p.photo = ''; delete p.photoPos; } }).then(() => renderRosters(true)).catch(fail);
};

byId('backup').onclick = () => download(`stats-${S().sport}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(S(), null, 1), 'application/json');
byId('restore').onchange = async event => {
  try {
    const data = JSON.parse(await event.target.files[0].text());
    if (!Array.isArray(data.events) || !Array.isArray(data.teams)) throw new Error('That file is not a stat keeper backup.');
    if (!await confirmBox('Restore this backup?', `It replaces the current stat game with ${data.events.length} plays.`, 'Restore')) return;
    await statsDoc.commit(s => { Object.assign(s, data); });
    renderRosters(true);
  } catch (error) { fail(error); }
  event.target.value = '';
};
byId('newStatGame').onclick = async () => {
  if (!await confirmBox('Start a new stat game?', 'Every logged play is cleared. Rosters stay.', 'Clear plays')) return;
  local.set('statsBackup', S());
  statsDoc.commit(s => { s.events = []; s.startedAt = 0; }).then(() => toast('New stat game. The old one is saved in this browser as a backup.')).catch(fail);
};

byId('sportPicker').onclick = async event => {
  const sport = event.target.dataset?.sport;
  if (!sport || sport === S().sport) return;
  if (S().events.length && !await confirmBox(`Switch stats to ${sport}?`, 'This clears the logged plays and rosters for a new game. Download a backup first if you need it.', 'Switch')) return;
  const fresh = defaultStats();
  statsDoc.commit(s => { Object.assign(s, {...fresh, sport, autoSend: s.autoSend}); }).then(() => renderRosters(true)).catch(fail);
};

// ── Box score ───────────────────────────────────────────────────────────────
function tables(sport, box) {
  const out = [];
  const name = p => `${p.player.num ? '#' + p.player.num + ' ' : ''}${p.player.name}`;
  box.teams.forEach((team, t) => {
    const blocks = [];
    if (sport === 'basketball') {
      const rows = team.players.filter(p => Object.values(p.line).some(Boolean)).map(p => {
        const l = p.line;
        return {p, cells: [name(p), l.pts, `${l.fgm}-${l.fga}`, `${l.tpm}-${l.tpa}`, `${l.ftm}-${l.fta}`, l.oreb, l.dreb, l.oreb + l.dreb, l.ast, l.stl, l.blk, l.to, l.pf]};
      });
      const l = team.line;
      rows.push({cells: ['TEAM', l.pts, `${l.fgm}-${l.fga}`, `${l.tpm}-${l.tpa}`, `${l.ftm}-${l.fta}`, l.oreb, l.dreb, l.oreb + l.dreb, l.ast, l.stl, l.blk, l.to, l.pf], total: true});
      blocks.push({title: 'Box score', columns: ['Player', 'PTS', 'FG', '3PT', 'FT', 'OREB', 'DREB', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PF'], rows});
    } else {
      const section = (title, columns, has, cells) => {
        const rows = team.players.filter(p => has(p.line)).map(p => ({p, cells: [name(p), ...cells(p.line)]}));
        if (rows.length) blocks.push({title, columns: ['Player', ...columns], rows});
      };
      section('Passing', ['C/ATT', 'YDS', 'TD', 'INT', 'LONG'], l => l.pass.att, l => [`${l.pass.cmp}/${l.pass.att}`, l.pass.yds, l.pass.td, l.pass.int, l.pass.long]);
      section('Rushing', ['CAR', 'YDS', 'AVG', 'TD', 'LONG'], l => l.rush.car, l => [l.rush.car, l.rush.yds, (l.rush.yds / l.rush.car).toFixed(1), l.rush.td, l.rush.long]);
      section('Receiving', ['REC', 'YDS', 'TD', 'LONG'], l => l.rec.rec, l => [l.rec.rec, l.rec.yds, l.rec.td, l.rec.long]);
      section('Defense', ['TKL', 'SACK', 'INT', 'FR'], l => l.def.tkl || l.def.sack || l.def.int || l.def.fr, l => [l.def.tkl, l.def.sack, l.def.int, l.def.fr]);
      section('Kicking', ['FG', 'LONG', 'XP'], l => l.kick.fga || l.kick.xpa, l => [`${l.kick.fgm}/${l.kick.fga}`, l.kick.long, `${l.kick.xpm}/${l.kick.xpa}`]);
      section('Punting', ['NO', 'YDS', 'AVG', 'LONG'], l => l.punt.no, l => [l.punt.no, l.punt.yds, (l.punt.yds / l.punt.no).toFixed(1), l.punt.long]);
      section('Returns', ['NO', 'YDS', 'TD'], l => l.ret.no, l => [l.ret.no, l.ret.yds, l.ret.td]);
    }
    out.push({team: t, blocks});
  });
  return out;
}

function renderBox() {
  const sport = S().sport;
  const box = boxScore(sport, S());
  const lines = lineScore(sport, S().events);
  const compare = compareRows(sport, box);
  const table = (columns, rows, withAir) => `<div class="scroll"><table><thead><tr>${columns.map((c, i) => `<th class="${i ? 'n' : ''}">${esc(c)}</th>`).join('')}${withAir ? '<th></th>' : ''}</tr></thead><tbody>${rows.map(r =>
    `<tr ${r.total ? 'style="font-weight:700"' : ''}>${r.cells.map((c, i) => `<td class="${i ? 'n' : ''}">${esc(c)}</td>`).join('')}${withAir ? `<td>${r.p ? `<button type="button" class="airBtn" data-air="${esc(r.p.player.id)}">On air</button>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
  let html = `<section class="card"><header><h2>Line score</h2></header>${table(['Team', ...lines.columns, 'T'], [0, 1].map(t => ({cells: [teamName(t), ...lines.rows[t], box.totals[t]]})))}</section>
    <section class="card"><header><h2>Team stats</h2></header>${table(['', teamShort(0), teamShort(1)], compare.map(r => ({cells: [r.label, r.left, r.right]})))}</section>`;
  for (const {team, blocks} of tables(sport, box)) {
    html += `<section class="card boxTeam" data-team="${team}"><h3>${esc(teamName(team))}</h3>${blocks.length ? blocks.map(b => `<span class="label">${esc(b.title)}</span>${table(b.columns, b.rows, true)}`).join('') : '<p class="muted">No stats yet.</p>'}</section>`;
  }
  byId('boxScore').innerHTML = html;
  $$('.boxTeam').forEach(section => {
    const team = Number(section.dataset.team);
    $$('[data-air]', section).forEach(b => { b.onclick = () => playerOnAir(team, b.dataset.air, box); });
  });
}

const POS = {QB: 'Quarterback', RB: 'Running Back', WR: 'Wide Receiver', TE: 'Tight End', LB: 'Linebacker', DB: 'Defensive Back', DL: 'Defensive Line', K: 'Kicker', P: 'Punter',
  CB: 'Cornerback', S: 'Safety', DE: 'Defensive End', DT: 'Defensive Tackle', G: 'Guard', F: 'Forward', C: 'Center', PG: 'Point Guard', SG: 'Shooting Guard', SF: 'Small Forward', PF: 'Power Forward'};
async function playerOnAir(team, id, box) {
  const player = S().teams[team].players.find(p => p.id === id);
  const entry = box.teams[team].players.find(p => p.player.id === id);
  if (!player || !entry) return;
  const graphic = {type: 'player', side: team, title: player.name, number: player.num || '', kicker: POS[(player.pos || '').toUpperCase()] || player.pos || teamName(team),
    subtitle: [teamName(team), player.cls].filter(Boolean).join(' · '), stat: statLine(S().sport, entry.line) || 'Tonight', photo: await photo(player.photo), photoPos: photoPosition(player.photoPos), rows: [], id: uid(), until: serverNow() + 10000};
  liveDoc.commit(d => { d.graphic = graphic; }).then(() => toast(`${player.name} is on air for 10 seconds`)).catch(fail);
}
byId('compareLive').onclick = () => {
  const sport = S().sport;
  const g = liveDoc.ready ? L().games[sport] : null;
  const graphic = {type: 'compare', side: -1, title: 'Team Stats', kicker: g?.period === 'HALF' ? 'Halftime' : g?.period === 'FINAL' ? 'Final' : '', subtitle: '',
    rows: compareRows(sport, boxScore(sport, S())), id: uid(), until: serverNow() + 12000};
  liveDoc.commit(d => { d.graphic = graphic; }).then(() => toast('Team stats are on air for 12 seconds')).catch(fail);
};
byId('print').onclick = () => print();
byId('exportCsv').onclick = () => {
  const sport = S().sport;
  const box = boxScore(sport, S());
  const csv = value => /[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value);
  const lines = [];
  for (const {team, blocks} of tables(sport, box)) {
    for (const block of blocks) {
      lines.push([teamName(team), block.title].map(csv).join(','));
      lines.push(block.columns.map(csv).join(','));
      block.rows.forEach(r => lines.push(r.cells.map(csv).join(',')));
      lines.push('');
    }
  }
  download(`box-score-${sport}-${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\n'), 'text/csv');
};

// ── Play-by-play ────────────────────────────────────────────────────────────
function renderPbp() {
  const sport = S().sport;
  const events = [...S().events].reverse();
  if (!events.length) { byId('pbp').innerHTML = '<p class="muted">No plays yet.</p>'; return; }
  byId('pbp').innerHTML = events.map(e => {
    const pts = points(sport, e);
    return `<div class="pbpRow"><span class="t">${esc(e.period || '')}${e.clock != null ? ' ' + clockText(e.clock, sport === 'basketball') : ''}</span><span><span class="swatch" style="--c:${esc(liveDoc.ready ? L().teams[e.team].color : '#888')}"></span>${esc(teamShort(e.team))}${pts ? ` <span class="pts">+${pts}</span>` : ''}</span>
      <span>${esc(describe(sport, e, S()))}</span><button type="button" class="ghost" data-del="${esc(e.id)}" aria-label="Delete play">✕</button></div>`;
  }).join('');
  $$('[data-del]', byId('pbp')).forEach(b => {
    b.onclick = () => statsDoc.commit(s => { s.events = s.events.filter(e => e.id !== b.dataset.del); }).then(() => sendToBug()).catch(fail);
  });
}

// ── Render + startup ────────────────────────────────────────────────────────
function render() {
  if (!statsDoc.ready) return;
  const s = S();
  local.set('statsBackupLive', {at: Date.now(), events: s.events.length});
  $$('#sportPicker [data-sport]').forEach(b => b.setAttribute('aria-pressed', b.dataset.sport === s.sport));
  byId('autoSend').checked = s.autoSend !== false;
  const total = score(s.sport, s.events);
  setText('sbScore0', total[0]); setText('sbScore1', total[1]);
  const own = byId('ownPeriod');
  if (!own.options.length) own.replaceChildren(...['1st', '2nd', '3rd', '4th', 'OT'].map(p => new Option(p, p)));
  if (!byId('tab-live').hidden) renderLive();
  if (!byId('tab-rosters').hidden) renderRosters();
  if (!byId('tab-box').hidden) renderBox();
  if (!byId('tab-pbp').hidden) renderPbp();
  renderSync();
}

onConnection(online => {
  const element = byId('connection');
  element.textContent = online ? 'Connected' : 'Offline — retrying';
  element.classList.toggle('online', online);
});

(async () => {
  try {
    const session = await getSession();
    if (!session) return;
    await Promise.all([statsDoc.start(), liveDoc.start(), libraryDoc.start()]);
    if (!statsDoc.ready) throw new Error('Could not load the stat game. Check the database connection and reload.');
    byId('app').hidden = false;
    setTab(local.get('statsTab', 'live'));
  } catch (error) {
    const box = byId('startupError');
    box.hidden = false;
    box.textContent = error.message;
  }
})();
