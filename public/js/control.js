import {$, $$, byId, clamp, clockText, copy, Doc, esc, getSession, hexColor, onConnection, overlayUrl, parseClock, readImage,
  readable, remaining, running, serverNow, setText, shade, signOut, toast, uid, validImage, download} from './common.js';
import {freshGame} from './defaults.js';
import {LEAGUES} from './ticker-layer.js';
import {boxScore, compareRows, score as statsScore, statLine} from './stats-engine.js';
import {ENCODINGS, FIELDS, SerialReader, decodeRaw, interpret, parseHex} from './serial.js';
import {roleOf} from './feed.js';

// ── Documents ───────────────────────────────────────────────────────────────
const liveDoc = new Doc('live', {onChange: () => render(), interval: 800});
const tickerDoc = new Doc('ticker', {onChange: () => renderTicker(), interval: 5000});
const libraryDoc = new Doc('library', {onChange: () => renderLibrary(), interval: 6000});
const statsDoc = new Doc('stats', {onChange: () => renderStatsLinks(), interval: 2500});
const L = () => liveDoc.doc;
const G = () => L().games[L().sport];
let overlayKey = '';
let feedKey = '';

const fail = error => toast(error.message || String(error), 'error');
function change(fn, message) {
  return liveDoc.commit(fn).then(ok => { if (ok && message) toast(message); return ok; }).catch(error => { fail(error); return false; });
}
const changeGame = fn => change(d => fn(d.games[d.sport], d));
const local = {
  get: (key, fallback) => { try { const v = localStorage.getItem('studio.' + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set: (key, value) => { try { localStorage.setItem('studio.' + key, JSON.stringify(value)); } catch {} },
};

function confirmBox(title, text, ok = 'OK') {
  const dialog = byId('confirmDialog');
  setText('confirmTitle', title);
  setText('confirmText', text);
  setText('confirmOk', ok);
  dialog.showModal();
  return new Promise(resolve => { dialog.onclose = () => resolve(dialog.returnValue === 'ok'); });
}
async function copyText(text, label) {
  try { await navigator.clipboard.writeText(text); toast(`${label} copied`); }
  catch { window.prompt('Copy this:', text); }
}
function options(select, entries, value) {
  const signature = JSON.stringify(entries);
  if (select.dataset.options !== signature) {
    select.replaceChildren(...entries.map(([id, label]) => new Option(label, id)));
    select.dataset.options = signature;
  }
  if (value !== undefined && document.activeElement !== select) select.value = String(value);
}
const sideOptions = () => [[-1, 'Studio accent'], [0, L().teams[0].name], [1, L().teams[1].name]];

// ── Tabs ────────────────────────────────────────────────────────────────────
const TABS = ['live', 'graphics', 'ticker', 'teams', 'style', 'scoreboard'];
function setTab(tab) {
  $$('nav.tabs [data-tab]').forEach(b => { if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  TABS.forEach(name => { byId('tab-' + name).hidden = name !== tab; });
  local.set('tab', tab);
}
$$('nav.tabs [data-tab]').forEach(b => { b.onclick = () => setTab(b.dataset.tab); });

// ── Live tab ────────────────────────────────────────────────────────────────
const PERIODS = {
  football: ['1st', '2nd', 'HALF', '3rd', '4th', 'OT', '2OT', '3OT', '4OT', 'FINAL'],
  basketball: ['1st', '2nd', 'HALF', '3rd', '4th', 'OT', '2OT', '3OT', 'FINAL'],
};
const STATUSES = {football: ['FLAG', 'TIMEOUT', 'INJURY', 'REVIEW', 'HALFTIME', 'FINAL'], basketball: ['TIMEOUT', 'REVIEW', 'HALFTIME', 'FINAL']};
const QUICK_BANNERS = {
  football: ['TOUCHDOWN {TEAM}', 'FIELD GOAL {TEAM}', 'SAFETY', 'INTERCEPTION', 'FUMBLE', 'FIRST DOWN', '2-PT GOOD', 'TIMEOUT {TEAM}'],
  basketball: ['3-POINTER', 'AND ONE', 'BUZZER BEATER', 'TIMEOUT {TEAM}', '{TEAM} IN THE BONUS', 'TECHNICAL FOUL'],
};
let builtSport = '';

function counter(i, key, label, max) {
  return `<div class="counter"><span>${label}</span><div>${key === 'fouls' ? `<span class="bonusTag" id="bonus${i}" hidden>BONUS</span>` : ''}<button type="button" data-counter="${key}" data-step="-1" data-max="${max}" aria-label="Minus ${label}">−</button><output id="${key}${i}"></output><button type="button" data-counter="${key}" data-step="1" data-max="${max}" aria-label="Plus ${label}">+</button></div></div>`;
}

function buildLive(sport) {
  builtSport = sport;
  document.body.classList.toggle('football', sport === 'football');
  document.body.classList.toggle('basketball', sport === 'basketball');
  const pointSet = sport === 'football' ? [6, 3, 2, 1, -1] : [3, 2, 1, -1, -2];
  byId('teamCards').innerHTML = [0, 1].map(i => `
    <section class="card teamCard" id="teamCard${i}">
      <div class="between"><h3 id="teamName${i}"></h3><span class="muted">${i === 0 ? 'LEFT' : 'RIGHT'}</span></div>
      <div class="scoreLine"><output class="readout" id="score${i}"></output>
        <form class="inline scoreSet"><input type="number" min="0" max="299" placeholder="Set" aria-label="Set score" required><button>Set</button></form></div>
      <div class="pointButtons">${pointSet.map(p => `<button type="button" data-points="${p}">${p > 0 ? '+' + p : '−' + -p}</button>`).join('')}</div>
      ${counter(i, 'timeouts', 'Timeouts left', 9)}
      ${sport === 'basketball' ? counter(i, 'fouls', 'Team fouls', 99) : ''}
    </section>`).join('');
  [0, 1].forEach(i => {
    const card = byId('teamCard' + i);
    $$('[data-points]', card).forEach(b => { b.onclick = () => addPoints(i, Number(b.dataset.points)); });
    $$('[data-counter]', card).forEach(b => {
      b.onclick = () => changeGame(g => { g[b.dataset.counter][i] = clamp(g[b.dataset.counter][i] + Number(b.dataset.step), 0, Number(b.dataset.max)); });
    });
    const form = $('form', card);
    form.onsubmit = event => { event.preventDefault(); const v = Number($('input', form).value); changeGame(g => { g.score[i] = clamp(v, 0, 299); }); form.reset(); };
  });
  $$('.auxName').forEach(e => { e.textContent = sport === 'football' ? 'play clock' : 'shot clock'; });
  byId('linkAuxBox').hidden = sport !== 'basketball';
  const aux = byId('auxButtons');
  const full = L().settings[sport][sport === 'football' ? 'playClock' : 'shotClock'];
  aux.innerHTML = sport === 'football'
    ? `<button type="button" class="primary" data-aux="40">${full} ▶</button><button type="button" data-aux="25">25</button><button type="button" id="auxToggle">Start</button>`
    : `<button type="button" class="primary" data-aux="reset">Reset ${full}</button><button type="button" id="auxToggle">Start</button>`;
  $$('[data-aux]', aux).forEach(b => { b.onclick = () => resetAux(b.dataset.aux); });
  byId('auxToggle').onclick = () => toggleClock('aux');
  byId('statusButtons').innerHTML = [...STATUSES[sport], 'CLEAR'].map(s => `<button type="button" data-status="${s}">${s === 'CLEAR' ? 'Clear' : s}</button>`).join('');
  $$('[data-status]').forEach(b => {
    b.onclick = () => changeGame(g => { g.status = b.dataset.status === 'CLEAR' || g.status === b.dataset.status ? '' : b.dataset.status; });
  });
  byId('bannerQuick').innerHTML = QUICK_BANNERS[sport].map(t => `<button type="button" data-banner="${esc(t)}">${esc(t.replace('{TEAM}', '…'))}</button>`).join('');
  $$('[data-banner]').forEach(b => { b.onclick = () => showBanner(b.dataset.banner, Number(byId('bannerSide').value)); });
}

function addPoints(i, points) {
  changeGame(g => { g.score[i] = clamp(g.score[i] + points, 0, 299); });
}

function toggleClock(key) {
  changeGame((g, d) => {
    const now = serverNow();
    const isRunning = running(g[key], now);
    const ms = remaining(g[key], now);
    if (!isRunning && !ms) return false;
    g[key] = isRunning ? {ms, end: 0} : {ms, end: now + ms};
    if (key === 'game' && d.sport === 'basketball' && byId('linkAux').checked) {
      const auxMs = remaining(g.aux, now);
      if (isRunning) g.aux = {ms: auxMs, end: 0};
      else if (auxMs > 0 && g.showAux) g.aux = {ms: auxMs, end: now + auxMs};
    }
  });
}

function setClock(key, ms) {
  changeGame(g => {
    const now = serverNow();
    g[key] = running(g[key], now) ? {ms, end: now + ms} : {ms, end: 0};
  });
}

function resetAux(kind) {
  changeGame((g, d) => {
    const now = serverNow();
    const s = d.settings[d.sport];
    if (d.sport === 'football') {
      const seconds = kind === '25' ? 25 : s.playClock;
      g.aux = kind === '25' ? {ms: seconds * 1000, end: 0} : {ms: seconds * 1000, end: now + seconds * 1000};
    } else {
      const ms = s.shotClock * 1000;
      g.aux = running(g.game, now) ? {ms, end: now + ms} : {ms, end: 0};
    }
    g.showAux = true;
  });
}

function periodMs(d, sport, period) {
  const s = d.settings[sport];
  if (/OT/.test(period)) return (sport === 'basketball' ? s.otMinutes || 4 : s.minutes) * 60000;
  return s.minutes * 60000;
}

function nextPeriod() {
  changeGame((g, d) => {
    const order = ['1st', '2nd', '3rd', '4th', 'OT', '2OT', '3OT', '4OT', '5OT'];
    const at = order.indexOf(g.period === 'HALF' ? '2nd' : g.period);
    if (at < 0 || at === order.length - 1) return false;
    g.period = order[at + 1];
    const ms = periodMs(d, d.sport, g.period);
    g.game = {ms, end: 0};
    g.status = '';
    if (d.sport === 'football') {
      if (g.period === '3rd') g.timeouts = [d.settings.football.timeouts, d.settings.football.timeouts];
      if (/OT/.test(g.period)) { g.showClock = false; g.down = 1; g.distance = '10'; }
    } else {
      g.fouls = [0, 0];
      g.aux = {ms: d.settings.basketball.shotClock * 1000, end: 0};
    }
  });
}

function showBanner(template, side) {
  const d = L();
  const team = side >= 0 ? d.teams[side].name.toUpperCase() : '';
  const text = template.replace(/\{TEAM\}/g, team).replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!text) return;
  const seconds = Number(byId('bannerSeconds').value);
  change(draft => {
    draft.banner = {id: uid(), text, side, until: seconds > 0 ? serverNow() + seconds * 1000 : 0};
  });
}

function renderLive() {
  const d = L();
  const g = G();
  if (builtSport !== d.sport) buildLive(d.sport);
  $$('#sportPicker [data-sport]').forEach(b => b.setAttribute('aria-pressed', b.dataset.sport === d.sport));
  const bug = byId('bugToggle');
  bug.setAttribute('aria-pressed', d.bugVisible);
  bug.textContent = d.bugVisible ? '● Scorebug ON AIR' : 'Scorebug off — show';
  const s = d.settings[d.sport];
  d.teams.forEach((team, i) => {
    byId('teamCard' + i).style.setProperty('--team-color', team.color);
    setText('teamName' + i, team.name);
    setText('score' + i, g.score[i]);
    setText('timeouts' + i, g.timeouts[i]);
    if (d.sport === 'basketball') {
      setText('fouls' + i, g.fouls[i]);
      byId('bonus' + i).hidden = g.fouls[1 - i] < s.bonusAt;
    }
  });
  byId('showClock').checked = g.showClock;
  byId('showAux').checked = g.showAux;
  setText('periodLength', `${s.minutes}:00 periods`);
  options(byId('periodSelect'), PERIODS[d.sport].map(p => [p, p]), g.period);
  options(byId('possessionSelect'), [[-1, 'None'], [0, d.teams[0].name], [1, d.teams[1].name]], g.possession);
  if (d.sport === 'basketball') options(byId('arrowSelect'), [[-1, 'Not shown'], [0, '◀ ' + d.teams[0].name], [1, d.teams[1].name + ' ▶']], g.arrow);
  if (d.sport === 'football') {
    const downs = byId('downButtons');
    if (!downs.children.length) {
      downs.innerHTML = [1, 2, 3, 4].map(n => `<button type="button" data-down="${n}">${['1st', '2nd', '3rd', '4th'][n - 1]} down</button>`).join('');
      $$('[data-down]', downs).forEach(b => { b.onclick = () => changeGame(game => { game.down = Number(b.dataset.down); }); });
    }
    $$('[data-down]').forEach(b => b.setAttribute('aria-pressed', Number(b.dataset.down) === g.down));
    byId('distanceInput').placeholder = g.distance;
    byId('ballOnInput').placeholder = g.ballOn || 'WES 34';
  }
  $$('[data-status]').forEach(b => b.setAttribute('aria-pressed', b.dataset.status === g.status));
  const bannerSide = byId('bannerSide');
  options(bannerSide, sideOptions(), bannerSide.dataset.touched ? undefined : (g.possession >= 0 && d.sport === 'football' ? g.possession : 0));
  if (!byId('bannerSeconds').value) byId('bannerSeconds').value = d.style.bannerSeconds;
  tick();
}

function tick() {
  if (!liveDoc.ready) return;
  const g = G();
  const now = serverNow();
  setText('gameReadout', clockText(remaining(g.game, now), L().sport === 'basketball'));
  setText('auxReadout', Math.ceil(remaining(g.aux, now) / 1000));
  const gameRunning = running(g.game, now);
  setText('gameToggle', gameRunning ? 'Stop' : 'Start');
  byId('gameToggle').classList.toggle('danger', gameRunning);
  byId('gameToggle').classList.toggle('primary', !gameRunning);
  const toggle = byId('auxToggle');
  if (toggle) setText(toggle, running(g.aux, now) ? 'Stop' : 'Start');
  const banner = L().banner;
  const bannerUp = banner && (!banner.until || now < banner.until);
  setText('bannerLive', bannerUp ? banner.text + (banner.until ? ` (${Math.ceil((banner.until - now) / 1000)}s)` : '') : 'None');
  byId('monitorClearBanner').disabled = !bannerUp;
  const graphic = L().graphic;
  const graphicUp = graphic && (!graphic.until || now < graphic.until);
  setText('graphicLive', graphicUp ? `${graphic.title}${graphic.until ? ` (${Math.ceil((graphic.until - now) / 1000)}s)` : ''}` : 'None');
  byId('monitorClearGraphic').disabled = !graphicUp;
  byId('gClear').disabled = !graphicUp;
  const onAir = L().bugVisible || bannerUp || graphicUp || tickerDoc.doc?.visible;
  const status = byId('outputStatus');
  setText(status, onAir ? 'ON AIR' : 'STANDBY');
  status.classList.toggle('live', Boolean(onAir));
}
setInterval(tick, 100);

byId('sportPicker').onclick = event => {
  const sport = event.target.dataset?.sport;
  if (!sport || sport === L().sport) return;
  change(d => { d.sport = sport; }, `Switched to ${sport}. Team names, colors and logos stay.`);
};
byId('bugToggle').onclick = () => change(d => { d.bugVisible = !d.bugVisible; });
byId('gameToggle').onclick = () => toggleClock('game');
byId('gameReset').onclick = () => changeGame((g, d) => { g.game = {ms: periodMs(d, d.sport, g.period), end: 0}; });
byId('gameSet').onsubmit = event => {
  event.preventDefault();
  const ms = parseClock(byId('gameInput').value);
  if (!Number.isFinite(ms) || ms > 60 * 60000) { toast('Use MM:SS, like 12:00 or 0:09.4', 'error'); return; }
  setClock('game', ms);
  byId('gameSet').reset();
};
byId('auxSet').onsubmit = event => {
  event.preventDefault();
  setClock('aux', clamp(Number(byId('auxInput').value), 0, 99) * 1000);
  byId('auxSet').reset();
};
byId('showClock').onchange = event => changeGame(g => { g.showClock = event.target.checked; });
byId('showAux').onchange = event => changeGame(g => { g.showAux = event.target.checked; });
byId('linkAux').checked = local.get('linkAux', true);
byId('linkAux').onchange = event => local.set('linkAux', event.target.checked);
byId('periodSelect').onchange = event => changeGame(g => { g.period = event.target.value; });
byId('possessionSelect').onchange = event => changeGame(g => { g.possession = Number(event.target.value); });
byId('arrowSelect').onchange = event => changeGame(g => { g.arrow = Number(event.target.value); });
byId('nextPeriod').onclick = nextPeriod;
byId('distanceForm').onsubmit = event => {
  event.preventDefault();
  const value = byId('distanceInput').value.trim();
  changeGame(g => { g.distance = /^g(oal)?$/i.test(value) ? 'Goal' : value.slice(0, 6); g.status = ''; });
  byId('distanceForm').reset();
};
byId('ballOnForm').onsubmit = event => {
  event.preventDefault();
  changeGame(g => { g.ballOn = byId('ballOnInput').value.trim().slice(0, 12); });
  byId('ballOnForm').reset();
};
byId('firstTen').onclick = () => changeGame(g => { g.down = 1; g.distance = '10'; g.status = ''; });
byId('goal').onclick = () => changeGame(g => { g.distance = 'Goal'; g.status = ''; });
byId('bannerSide').onchange = event => { event.target.dataset.touched = '1'; };
byId('bannerForm').onsubmit = event => { event.preventDefault(); showBanner(byId('bannerText').value, Number(byId('bannerSide').value)); };
const clearBanner = () => change(d => { d.banner = null; });
byId('bannerClear').onclick = clearBanner;
byId('monitorClearBanner').onclick = clearBanner;

// ── Graphics tab ────────────────────────────────────────────────────────────
let draft = local.get('draft', null) || {type: 'player', kicker: '', title: '', subtitle: '', number: '', stat: '', side: 0, photo: '', image: '', rows: []};
let draftLoaded = false;

function readDraftForm() {
  draft.kicker = byId('gKicker').value.trim();
  draft.title = byId('gTitle').value.trim();
  draft.subtitle = byId('gSub').value.trim();
  draft.number = byId('gNumber').value.trim();
  draft.stat = byId('gStat').value.trim();
  draft.side = Number(byId('gSide').value);
  draft.rows = $$('.gRowEdit', byId('gRows')).map(row => {
    const inputs = $$('input', row).map(i => i.value.trim());
    return draft.type === 'compare' ? {left: inputs[0], label: inputs[1], right: inputs[2]} : {label: inputs[0], left: inputs[1]};
  }).filter(r => r.label);
  local.set('draft', draft);
}

function rowEditor(row = {}) {
  const element = document.createElement('div');
  const compare = draft.type === 'compare';
  element.className = 'gRowEdit' + (compare ? '' : ' single');
  element.innerHTML = compare
    ? `<input maxlength="30" placeholder="Left" value="${esc(row.left || '')}"><input maxlength="40" placeholder="Label" value="${esc(row.label || '')}"><input maxlength="30" placeholder="Right" value="${esc(row.right || '')}"><button type="button" class="ghost" aria-label="Remove row">✕</button>`
    : `<input maxlength="40" placeholder="Label" value="${esc(row.label || '')}"><input maxlength="30" placeholder="Value" value="${esc(row.left || '')}"><button type="button" class="ghost" aria-label="Remove row">✕</button>`;
  $('button', element).onclick = () => { element.remove(); readDraftForm(); };
  return element;
}

function loadDraftForm() {
  const type = draft.type;
  $$('#graphicType [data-type]').forEach(b => b.setAttribute('aria-pressed', b.dataset.type === type));
  byId('gKicker').value = draft.kicker || '';
  byId('gTitle').value = draft.title || '';
  byId('gSub').value = draft.subtitle || '';
  byId('gNumber').value = draft.number || '';
  byId('gStat').value = draft.stat || '';
  if (liveDoc.ready) options(byId('gSide'), sideOptions(), draft.side ?? -1);
  setText('gTitleLabel', type === 'player' ? 'Name' : 'Headline');
  $$('.gPlayer').forEach(e => { e.hidden = type !== 'player'; });
  $('.gImageRow').hidden = type === 'compare';
  setText('gImageLabel', type === 'player' ? 'Player photo' : 'Logo / sponsor image');
  const image = type === 'player' ? draft.photo : draft.image;
  byId('gImagePreview').hidden = !validImage(image);
  if (validImage(image)) byId('gImagePreview').src = image;
  setText('gImageStatus', validImage(image) ? '' : 'No image');
  byId('gRows').replaceChildren(...(draft.rows || []).map(rowEditor));
  setText($('#gRowsBox legend'), type === 'compare' ? 'Stat rows (left team · label · right team)' : 'Rows (label · value, optional)');
}

$$('#graphicType [data-type]').forEach(b => {
  b.onclick = () => {
    readDraftForm();
    if (draft.type !== b.dataset.type) {
      draft.type = b.dataset.type;
      draft.rows = (draft.rows || []).map(r => ({label: r.label, left: r.left, right: r.right}));
      if (draft.type === 'compare' && !draft.rows.length) draft.rows = [{label: '', left: '', right: ''}];
    }
    loadDraftForm();
  };
});
byId('graphicForm').oninput = () => readDraftForm();
byId('gAddRow').onclick = () => {
  if ($$('.gRowEdit').length >= 6) { toast('Six rows at most.', 'error'); return; }
  byId('gRows').append(rowEditor());
};
byId('gImage').onchange = async event => {
  try {
    const isPhoto = draft.type === 'player';
    const data = await readImage(event.target.files[0], isPhoto ? {maxWidth: 340, maxHeight: 420, type: 'image/jpeg', quality: 0.84} : {maxWidth: 360, maxHeight: 180});
    if (isPhoto) draft.photo = data; else draft.image = data;
    local.set('draft', draft);
    loadDraftForm();
  } catch (error) { fail(error); }
  event.target.value = '';
};
byId('gImageClear').onclick = () => { if (draft.type === 'player') draft.photo = ''; else draft.image = ''; loadDraftForm(); local.set('draft', draft); };

function graphicFromDraft(source = draft) {
  const graphic = {type: source.type, title: source.title.slice(0, 90), kicker: source.kicker || '', subtitle: source.subtitle || '', side: source.side ?? -1, rows: (source.rows || []).slice(0, 6)};
  if (source.type === 'player') Object.assign(graphic, {number: source.number || '', stat: source.stat || '', photo: source.photo || ''});
  if (source.type === 'message') graphic.image = source.image || '';
  return graphic;
}

function takeGraphic(source) {
  const graphic = graphicFromDraft(source);
  if (!graphic.title) { toast('Add a name or headline first.', 'error'); return; }
  const seconds = Number(byId('gSeconds').value) || 0;
  local.set('gSeconds', seconds);
  change(d => { d.graphic = {...graphic, id: uid(), until: seconds > 0 ? serverNow() + seconds * 1000 : 0}; }, 'Graphic is live');
}
byId('graphicForm').onsubmit = event => { event.preventDefault(); readDraftForm(); takeGraphic(draft); };
const clearGraphic = () => change(d => { d.graphic = null; });
byId('gClear').onclick = clearGraphic;
byId('monitorClearGraphic').onclick = clearGraphic;
byId('gSeconds').value = local.get('gSeconds', 0) || '';
byId('gSave').onclick = () => {
  readDraftForm();
  if (!draft.title) { toast('Add a name or headline first.', 'error'); return; }
  libraryDoc.commit(lib => {
    lib.presets.unshift({id: uid(), graphic: graphicFromDraft()});
    lib.presets = lib.presets.slice(0, 60);
  }).then(() => toast('Preset saved')).catch(fail);
};

function renderPresets() {
  const list = byId('presets');
  const presets = libraryDoc.doc?.presets || [];
  if (!presets.length) { list.innerHTML = '<p class="muted">Save a graphic to reuse it with one click.</p>'; return; }
  list.replaceChildren(...presets.map(preset => {
    const row = document.createElement('div');
    row.className = 'listRow';
    const g = preset.graphic;
    row.innerHTML = `<span class="onair">${esc(g.type.toUpperCase())}</span><strong>${esc(g.title)}${g.kicker ? ` <span class="muted">· ${esc(g.kicker)}</span>` : ''}</strong>
      <button type="button" class="primary" data-act="take">Take live</button><button type="button" data-act="edit">Edit</button><button type="button" class="ghost" data-act="delete" aria-label="Delete">✕</button>`;
    row.querySelector('[data-act=take]').onclick = () => takeGraphic(g);
    row.querySelector('[data-act=edit]').onclick = () => { draft = {...copy(g), photo: g.photo || '', image: g.image || ''}; loadDraftForm(); local.set('draft', draft); };
    row.querySelector('[data-act=delete]').onclick = () => libraryDoc.commit(lib => { lib.presets = lib.presets.filter(p => p.id !== preset.id); }).catch(fail);
    return row;
  }));
}

// Pull from the stat keeper.
function renderStatsLinks() {
  const stats = statsDoc.doc;
  if (!stats || !liveDoc.ready) return;
  const sameSport = stats.sport === L().sport;
  setText('statsInfo', stats.events.length ? `${stats.events.length} plays logged · ${stats.sport}` : 'No stats yet. Open the stat keeper to start.');
  options(byId('statTeam'), [[0, L().teams[0].name], [1, L().teams[1].name]]);
  const team = Number(byId('statTeam').value) || 0;
  const players = stats.teams[team]?.players || [];
  options(byId('statPlayer'), players.length ? players.map(p => [p.id, `#${p.num} ${p.name}`]) : [['', 'No roster loaded']]);
  byId('loadPlayer').disabled = !players.length || !sameSport;
  byId('loadCompare').disabled = !stats.events.length || !sameSport;
  // Score check against the bug.
  const bar = byId('statsSync');
  if (sameSport && stats.events.length) {
    const s = statsScore(stats.sport, stats.events);
    const g = G();
    const differs = s[0] !== g.score[0] || s[1] !== g.score[1];
    bar.hidden = !differs;
    if (differs) setText('statsSyncText', `Stat keeper has ${s[0]}–${s[1]}, scorebug shows ${g.score[0]}–${g.score[1]}.`);
  } else bar.hidden = true;
}
byId('statTeam').onchange = renderStatsLinks;
byId('statsSyncApply').onclick = () => {
  const s = statsScore(statsDoc.doc.sport, statsDoc.doc.events);
  changeGame(g => { g.score = s; });
};

async function photoData(ref) {
  if (!ref) return '';
  if (validImage(ref)) return ref;
  if (!/^photo:/.test(ref)) return '';
  try {
    const response = await fetch('/api/doc?key=' + encodeURIComponent(ref), {cache: 'no-store'});
    return response.ok ? (await response.json()).doc.data : '';
  } catch { return ''; }
}

byId('loadPlayer').onclick = async () => {
  const stats = statsDoc.doc;
  const team = Number(byId('statTeam').value) || 0;
  const id = byId('statPlayer').value;
  const player = stats.teams[team].players.find(p => p.id === id);
  if (!player) return;
  const box = boxScore(stats.sport, stats);
  const entry = box.teams[team].players.find(p => p.player.id === id);
  const POS = {QB: 'Quarterback', RB: 'Running Back', WR: 'Wide Receiver', TE: 'Tight End', LB: 'Linebacker', DB: 'Defensive Back', DL: 'Defensive Line', OL: 'Offensive Line', K: 'Kicker', P: 'Punter',
    CB: 'Cornerback', S: 'Safety', DE: 'Defensive End', DT: 'Defensive Tackle', ATH: 'Athlete', G: 'Guard', F: 'Forward', C: 'Center', PG: 'Point Guard', SG: 'Shooting Guard', SF: 'Small Forward', PF: 'Power Forward'};
  const CLS = {FR: 'Freshman', SO: 'Sophomore', JR: 'Junior', SR: 'Senior', 9: 'Freshman', 10: 'Sophomore', 11: 'Junior', 12: 'Senior'};
  draft = {
    type: 'player', side: team, title: player.name, number: player.num || '',
    kicker: POS[(player.pos || '').toUpperCase()] || player.pos || L().teams[team].name,
    subtitle: [L().teams[team].name, CLS[String(player.cls || '').toUpperCase().replace('.', '')] || player.cls].filter(Boolean).join(' · '),
    stat: statLine(stats.sport, entry?.line) || 'Tonight',
    photo: await photoData(player.photo), image: '', rows: [],
  };
  loadDraftForm();
  local.set('draft', draft);
  toast('Player card loaded. Check it, then take it live.');
};
byId('loadCompare').onclick = () => {
  const stats = statsDoc.doc;
  const g = G();
  draft = {type: 'compare', side: -1, title: 'Team Stats', kicker: g.period === 'HALF' ? 'Halftime' : g.period === 'FINAL' ? 'Final' : `${g.period} ${stats.sport === 'football' ? 'Quarter' : 'Period'}`,
    subtitle: '', rows: compareRows(stats.sport, boxScore(stats.sport, stats)), photo: '', image: ''};
  loadDraftForm();
  local.set('draft', draft);
};

// ── Ticker tab ──────────────────────────────────────────────────────────────
let tickerDirty = false;
const markTickerDirty = () => { tickerDirty = true; setText('tickerDirty', 'Unsaved changes'); };
byId('tickerForm').addEventListener('input', markTickerDirty);
byId('tLeagues').innerHTML = Object.entries(LEAGUES).map(([key, league]) => `<label class="check"><input type="checkbox" value="${key}"> ${league.label}${key.includes('top25') ? ' (ranked only)' : ''}</label>`).join('');

function gameRow(game = {}) {
  const tr = document.createElement('tr');
  const cell = (key, cls = '', max = 30) => `<td><input class="${cls}" data-k="${key}" maxlength="${max}" value="${esc(game[key] ?? '')}"></td>`;
  tr.innerHTML = `${cell('league', 'lg', 12)}${cell('away')}${cell('awayScore', 's', 3)}${cell('home')}${cell('homeScore', 's', 3)}${cell('status', '', 16)}
    <td><input type="checkbox" data-k="show" ${game.show === 'no' ? '' : 'checked'}></td><td><button type="button" class="ghost" aria-label="Remove">✕</button></td>`;
  $('button', tr).onclick = () => { tr.remove(); markTickerDirty(); };
  return tr;
}
function sheetRow(sheet = {}) {
  const row = document.createElement('div');
  row.className = 'sheetRow';
  row.innerHTML = `<input data-k="label" placeholder="Label (AHSAA)" maxlength="20" value="${esc(sheet.label || '')}"><input data-k="url" placeholder="https://docs.google.com/spreadsheets/d/…" value="${esc(sheet.url || '')}"><button type="button" class="ghost" aria-label="Remove">✕</button>`;
  $('button', row).onclick = () => { row.remove(); markTickerDirty(); };
  return row;
}
byId('tAddGame').onclick = () => { byId('tGames').tBodies[0].append(gameRow()); markTickerDirty(); };
byId('tAddSheet').onclick = () => { byId('tSheets').append(sheetRow()); markTickerDirty(); };

function renderTicker(force = false) {
  const t = tickerDoc.doc;
  if (!t) return;
  const toggle = byId('tickerToggle');
  toggle.setAttribute('aria-pressed', t.visible);
  toggle.textContent = t.visible ? '● Ticker ON AIR' : 'Ticker off — show';
  setText('tickerLive', t.visible ? 'On air' : 'Off');
  setText('monitorTicker', t.visible ? 'Hide' : 'Show');
  if (tickerDirty && !force) return;
  byId('tLayout').value = t.layout;
  byId('tCorner').value = t.corner;
  byId('tTitle').value = t.title;
  byId('tSeconds').value = t.secondsPerGame;
  byId('tAccent').value = t.accentColor;
  byId('tWinner').value = t.winnerColor;
  byId('tMargin').value = t.edgeMargin;
  byId('tEmpty').value = t.emptyMessage;
  byId('tLogos').checked = t.showLogos;
  byId('tRanks').checked = t.showRankings;
  byId('tRecords').checked = t.showRecords;
  byId('tUpcoming').checked = t.showUpcoming;
  byId('tHideEmpty').checked = t.hideWhenEmpty;
  byId('tLive').checked = t.includeLive;
  byId('tLiveLabel').value = t.liveLabel;
  byId('tTeams').value = (t.teams || []).join(', ');
  $$('#tLeagues input').forEach(i => { i.checked = t.leagues.includes(i.value); });
  byId('tGames').tBodies[0].replaceChildren(...t.games.map(gameRow));
  byId('tSheets').replaceChildren(...t.sheets.map(sheetRow));
  tickerDirty = false;
  setText('tickerDirty', '');
}
byId('tickerForm').onsubmit = event => {
  event.preventDefault();
  const games = [...byId('tGames').tBodies[0].rows].map(tr => {
    const game = {};
    $$('input', tr).forEach(i => { game[i.dataset.k] = i.type === 'checkbox' ? (i.checked ? '' : 'no') : i.value.trim(); });
    return game;
  }).filter(g => g.away || g.home);
  const sheets = $$('.sheetRow').map(r => ({label: $('[data-k=label]', r).value.trim(), url: $('[data-k=url]', r).value.trim()})).filter(s => s.url);
  tickerDoc.commit(t => {
    Object.assign(t, {
      layout: byId('tLayout').value, corner: byId('tCorner').value, title: byId('tTitle').value.trim() || 'SCORES',
      secondsPerGame: clamp(Number(byId('tSeconds').value) || 6, 2, 30), accentColor: byId('tAccent').value, winnerColor: byId('tWinner').value,
      edgeMargin: clamp(Number(byId('tMargin').value) || 0, 0, 200), emptyMessage: byId('tEmpty').value.trim(),
      showLogos: byId('tLogos').checked, showRankings: byId('tRanks').checked, showRecords: byId('tRecords').checked,
      showUpcoming: byId('tUpcoming').checked, hideWhenEmpty: byId('tHideEmpty').checked,
      includeLive: byId('tLive').checked, liveLabel: byId('tLiveLabel').value.trim() || 'THIS GAME',
      teams: byId('tTeams').value.split(',').map(s => s.trim()).filter(Boolean),
      leagues: $$('#tLeagues input:checked').map(i => i.value), games, sheets,
    });
  }).then(() => { tickerDirty = false; renderTicker(true); toast('Ticker saved'); }).catch(fail);
};
const toggleTicker = () => tickerDoc.commit(t => { t.visible = !t.visible; }).catch(fail);
byId('tickerToggle').onclick = toggleTicker;
byId('monitorTicker').onclick = toggleTicker;

// ── Teams tab ───────────────────────────────────────────────────────────────
const teamDrafts = [null, null];
let teamsDirty = false;

function teamEditor(i) {
  const t = teamDrafts[i];
  const box = document.createElement('div');
  box.className = 'sub teamEdit';
  box.style.setProperty('--team-color', t.color);
  const colorField = (key, label) => `<label>${label}<div class="colorPair"><input type="color" data-k="${key}" value="${esc(t[key])}"><input type="text" data-hex="${key}" value="${esc(t[key])}" maxlength="7"></div></label>`;
  box.innerHTML = `
    <div class="teamPreview" style="--t:${esc(t.color)};--td:${shade(t.color, 0.72)};--ti:${readable(t.color)};--ta:${esc(t.accent)}">${validImage(t.logo) ? `<img src="${esc(t.logo)}" alt="">` : ''}<strong>${esc(t.name)}</strong></div>
    <div class="grid2"><label>School / team name<input data-k="name" maxlength="40" value="${esc(t.name)}" required></label><label>Abbreviation<input data-k="short" maxlength="5" value="${esc(t.short)}" required></label></div>
    <div class="grid2"><label>Ranking<input data-k="rank" maxlength="3" value="${esc(t.rank)}" placeholder="—"></label><label>Record<input data-k="record" maxlength="12" value="${esc(t.record || '')}" placeholder="8-2"></label></div>
    <div class="grid2">${colorField('color', 'Main color')}${colorField('accent', 'Edge stripe color')}</div>
    <label>Logo<input type="file" data-logo accept="image/png,image/jpeg,image/webp,image/svg+xml"></label>
    <div class="row"><label class="check"><input type="checkbox" data-k="logoBacking" ${t.logoBacking ? 'checked' : ''}> White circle behind logo</label><button type="button" class="ghost" data-remove-logo ${t.logo ? '' : 'disabled'}>Remove logo</button></div>
    <div class="row"><select data-library aria-label="Load from library"></select><button type="button" data-load>Load</button><button type="button" data-save>Save to library</button></div>`;
  $$('[data-k]', box).forEach(input => {
    input.oninput = () => {
      const key = input.dataset.k;
      t[key] = input.type === 'checkbox' ? input.checked : input.value;
      if (input.type === 'color') $(`[data-hex=${key}]`, box).value = input.value;
      teamsDirty = true;
      refreshPreview(box, t);
    };
  });
  $$('[data-hex]', box).forEach(input => {
    input.oninput = () => {
      const value = hexColor(input.value);
      if (!value) return;
      t[input.dataset.hex] = value;
      $(`[data-k=${input.dataset.hex}]`, box).value = value;
      teamsDirty = true;
      refreshPreview(box, t);
    };
  });
  $('[data-logo]', box).onchange = async event => {
    try {
      t.logo = await readImage(event.target.files[0], {maxWidth: 256, maxHeight: 256});
      teamsDirty = true;
      renderTeamEditors(false);
    } catch (error) { fail(error); }
  };
  $('[data-remove-logo]', box).onclick = () => { t.logo = ''; teamsDirty = true; renderTeamEditors(false); };
  const library = libraryDoc.doc?.teams || [];
  options($('[data-library]', box), library.length ? library.map(x => [x.id, x.name]) : [['', 'Library is empty']]);
  $('[data-load]', box).onclick = () => {
    const saved = library.find(x => x.id === $('[data-library]', box).value);
    if (!saved) return;
    teamDrafts[i] = {...copy(saved)};
    delete teamDrafts[i].id;
    teamsDirty = true;
    renderTeamEditors(false);
  };
  $('[data-save]', box).onclick = () => saveTeamToLibrary(t);
  return box;
}
function refreshPreview(box, t) {
  const preview = $('.teamPreview', box);
  preview.style.cssText = `--t:${t.color};--td:${shade(t.color, 0.72)};--ti:${readable(t.color)};--ta:${t.accent}`;
  $('strong', preview).textContent = t.name;
  box.style.setProperty('--team-color', t.color);
}
let teamsKey = '';
function renderTeamEditors(fromLive = true) {
  if (fromLive) {
    if (teamsDirty) return;
    const key = JSON.stringify([L().teams, (libraryDoc.doc?.teams || []).map(t => t.id)]);
    if (key === teamsKey) return;
    teamsKey = key;
    L().teams.forEach((team, i) => { teamDrafts[i] = copy(team); });
  }
  byId('teamEditors').replaceChildren(teamEditor(0), teamEditor(1));
}
function cleanTeam(t) {
  return {name: t.name.trim().slice(0, 60) || 'Team', short: (t.short.trim() || t.name.slice(0, 3)).toUpperCase().slice(0, 5), rank: String(t.rank || '').trim().slice(0, 3),
    record: String(t.record || '').trim().slice(0, 12), color: hexColor(t.color) || '#323a46', accent: hexColor(t.accent) || '#323a46', logo: t.logo || '', logoBacking: Boolean(t.logoBacking)};
}
byId('teamForm').onsubmit = event => {
  event.preventDefault();
  change(d => { d.teams = teamDrafts.map(cleanTeam); }, 'Teams applied').then(ok => { if (ok) { teamsDirty = false; renderTeamEditors(); } });
};
function saveTeamToLibrary(t) {
  const team = cleanTeam(t);
  libraryDoc.commit(lib => {
    const existing = lib.teams.find(x => x.name.toLowerCase() === team.name.toLowerCase());
    if (existing) Object.assign(existing, team);
    else lib.teams.push({id: uid(), ...team});
    lib.teams.sort((a, b) => a.name.localeCompare(b.name));
  }).then(() => toast(`${team.name} saved to library`)).catch(fail);
}
byId('swapTeams').onclick = async () => {
  const swapPair = list => [list[1], list[0]];
  const flip = n => (n === 0 ? 1 : n === 1 ? 0 : n);
  const ok = await change(d => {
    d.teams = swapPair(d.teams);
    for (const g of Object.values(d.games)) {
      g.score = swapPair(g.score); g.timeouts = swapPair(g.timeouts); g.possession = flip(g.possession);
      if (g.fouls) g.fouls = swapPair(g.fouls);
      if ('arrow' in g) g.arrow = flip(g.arrow);
    }
    if (d.banner) d.banner.side = flip(d.banner.side);
    if (d.graphic) d.graphic.side = flip(d.graphic.side ?? -1);
  }, 'Sides swapped');
  if (ok && statsDoc.doc && (statsDoc.doc.events.length || statsDoc.doc.teams.some(t => t.players.length))) {
    statsDoc.commit(s => {
      s.teams = swapPair(s.teams);
      s.events.forEach(e => { e.team = 1 - e.team; });
    }).catch(fail);
  }
  teamsDirty = false;
  renderTeamEditors();
};

function renderLibrary() {
  renderPresets();
  if (liveDoc.ready) renderTeamEditors(!teamsDirty);
  const list = byId('teamLibrary');
  const teams = libraryDoc.doc?.teams || [];
  if (!teams.length) list.innerHTML = '<p class="muted">Use "Save to library" on a team to keep its colors and logo.</p>';
  else list.replaceChildren(...teams.map(team => {
    const row = document.createElement('div');
    row.className = 'listRow';
    row.innerHTML = `${validImage(team.logo) ? `<img src="${esc(team.logo)}" alt="">` : `<span class="swatch" style="--c:${esc(team.color)}"></span>`}<strong>${esc(team.name)} <span class="muted">${esc(team.short)}</span></strong>
      <button type="button" data-side="0">Use left</button><button type="button" data-side="1">Use right</button><button type="button" class="ghost" data-delete aria-label="Delete">✕</button>`;
    $$('[data-side]', row).forEach(b => {
      b.onclick = () => {
        const {id, ...rest} = team;
        change(d => { d.teams[Number(b.dataset.side)] = cleanTeam({...d.teams[Number(b.dataset.side)], ...rest}); }, `${team.name} is on the ${b.dataset.side === '0' ? 'left' : 'right'}`)
          .then(() => { teamsDirty = false; renderTeamEditors(); });
      };
    });
    $('[data-delete]', row).onclick = () => libraryDoc.commit(lib => { lib.teams = lib.teams.filter(t => t.id !== team.id); }).catch(fail);
    return row;
  }));
  renderSerialProfiles();
}

// ── Style tab ───────────────────────────────────────────────────────────────
let styleDirty = false;
byId('styleForm').addEventListener('input', () => { styleDirty = true; });
function renderStyle() {
  if (styleDirty) return;
  const {style, settings} = L();
  byId('sLayout').value = style.layout; byId('sPosition').value = style.position; byId('sScale').value = style.scale;
  byId('sNames').value = style.names; byId('sNudgeX').value = style.nudgeX; byId('sNudgeY').value = style.nudgeY;
  byId('sGraphic').value = style.graphicPlacement; byId('sBanner').value = style.bannerSeconds;
  byId('sDark').value = style.dark; byId('sAccent').value = style.accent; byId('sPanel').value = style.panel || '#f2f4f7';
  byId('sRank').checked = style.showRank; byId('sRecords').checked = style.showRecords;
  byId('fMinutes').value = settings.football.minutes; byId('fTimeouts').value = settings.football.timeouts; byId('fPlay').value = settings.football.playClock;
  byId('bMinutes').value = settings.basketball.minutes; byId('bOT').value = settings.basketball.otMinutes || 4; byId('bTimeouts').value = settings.basketball.timeouts;
  byId('bShot').value = settings.basketball.shotClock; byId('bBonus').value = settings.basketball.bonusAt;
}
byId('styleForm').onsubmit = event => {
  event.preventDefault();
  const n = (id, min, max) => clamp(Math.round(Number(byId(id).value) || 0), min, max);
  change(d => {
    Object.assign(d.style, {
      layout: byId('sLayout').value, position: byId('sPosition').value, scale: n('sScale', 40, 200), names: byId('sNames').value,
      nudgeX: n('sNudgeX', -1920, 1920), nudgeY: n('sNudgeY', -1080, 1080), graphicPlacement: byId('sGraphic').value,
      bannerSeconds: n('sBanner', 0, 120), dark: byId('sDark').value, accent: byId('sAccent').value, panel: byId('sPanel').value,
      showRank: byId('sRank').checked, showRecords: byId('sRecords').checked,
    });
    Object.assign(d.settings.football, {minutes: n('fMinutes', 1, 30), timeouts: n('fTimeouts', 0, 9), playClock: n('fPlay', 5, 99)});
    Object.assign(d.settings.basketball, {minutes: n('bMinutes', 1, 30), otMinutes: n('bOT', 1, 10), timeouts: n('bTimeouts', 0, 9), shotClock: n('bShot', 5, 99), bonusAt: n('bBonus', 1, 20)});
  }, 'Style saved').then(ok => { if (ok) { styleDirty = false; builtSport = ''; render(); } });
};
byId('newGame').onclick = async () => {
  const sport = L().sport;
  if (!await confirmBox(`Start a new ${sport} game?`, 'Scores, clocks, timeouts, banner and graphic reset. Teams, colors, logos and style stay.', 'Reset game')) return;
  change(d => { d.games[sport] = freshGame(sport, d.settings); d.banner = null; d.graphic = null; }, 'New game ready');
};

function renderObsLinks() {
  const links = [
    ['Full overlay', 'Scorebug, banner, graphics and ticker', overlayUrl(overlayKey)],
    ['Scorebug + banner', 'Just the bug', overlayUrl(overlayKey, 'bug,banner')],
    ['Graphics only', 'Lower thirds', overlayUrl(overlayKey, 'graphic')],
    ['Ticker only', 'Score ticker', overlayUrl(overlayKey, 'ticker')],
    ['Control panel dock', 'OBS → Docks → Custom Browser Docks', new URL('/control', location.origin).href],
    ['Stat keeper', 'For the stats laptop or tablet', new URL('/stats', location.origin).href],
  ];
  byId('obsLinks').replaceChildren(...links.map(([name, hint, url]) => {
    const row = document.createElement('div');
    row.className = 'listRow';
    row.innerHTML = `<div style="min-width:160px"><strong>${esc(name)}</strong><div class="muted">${esc(hint)}</div></div><code>${esc(url.replace(/#key=.*/, '#key=…'))}</code><button type="button">Copy</button>`;
    $('button', row).onclick = () => copyText(url, name);
    return row;
  }));
}

// ── Scoreboard (serial) tab ─────────────────────────────────────────────────
let mapping = local.get('serialMapping', {baud: 9600, start: '', end: '', length: 0, fields: {}});
const serialFields = () => [...FIELDS.common, ...FIELDS[L().sport]];
let lastFrame = [];
const changedAt = [];
const lastDecoded = {};
let frames = 0, rateTimer = 0;
const reader = new SerialReader(onFrame, onSerialState);
let serialConnected = false;
const clockTrack = {value: null, changedAt: 0, running: false};

function framing() { return {start: parseHex(mapping.start), end: parseHex(mapping.end), length: Number(mapping.length) || 0}; }
function saveMapping() { local.set('serialMapping', mapping); reader.setFraming(framing()); }

function renderSerial() {
  byId('serBaud').value = String(mapping.baud);
  byId('serStart').value = mapping.start;
  byId('serEnd').value = mapping.end;
  byId('serLength').value = mapping.length || '';
  byId('serApply').checked = local.get('serialApply', false);
  const body = byId('serMap').tBodies[0];
  body.replaceChildren(...serialFields().map(([key, label]) => {
    const f = mapping.fields[key] || {offset: '', length: 1, encoding: 'ascii'};
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${esc(label)}</td><td><input type="number" min="0" max="511" data-f="offset" value="${esc(f.offset)}" placeholder="—"></td>
      <td><input type="number" min="1" max="8" data-f="length" value="${esc(f.length)}"></td>
      <td><select data-f="encoding">${ENCODINGS.map(([v, l]) => `<option value="${v}" ${f.encoding === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td class="dec" id="dec-${key}">—</td>`;
    $$('[data-f]', tr).forEach(input => {
      input.onchange = () => {
        const next = {...(mapping.fields[key] || {offset: '', length: 1, encoding: 'ascii'})};
        next[input.dataset.f] = input.dataset.f === 'encoding' ? input.value : input.value === '' ? '' : Number(input.value);
        if (next.offset === '') delete mapping.fields[key]; else mapping.fields[key] = next;
        saveMapping();
        renderFrame();
      };
    });
    return tr;
  }));
  if (!SerialReader.supported()) {
    byId('serialSupport').textContent = 'This browser cannot read serial ports. Open the control panel in Chrome or Edge on a Windows or Mac laptop to import scoreboard data.';
    byId('serConnect').disabled = true;
  }
}
['serBaud', 'serStart', 'serEnd', 'serLength'].forEach(id => {
  byId(id).onchange = () => {
    mapping.baud = Number(byId('serBaud').value);
    mapping.start = byId('serStart').value.trim();
    mapping.end = byId('serEnd').value.trim();
    mapping.length = Number(byId('serLength').value) || 0;
    saveMapping();
  };
});
byId('serApply').onchange = event => { local.set('serialApply', event.target.checked); renderSerialChip(); };
byId('serConnect').onclick = async () => {
  try { await reader.connect({baud: mapping.baud, framing: framing()}); }
  catch (error) { if (error.name !== 'NotFoundError') toast('Could not open the port: ' + error.message, 'error'); }
};
byId('serDisconnect').onclick = () => reader.disconnect();

function onSerialState(state, detail) {
  serialConnected = state === 'connected';
  const chip = byId('serialState');
  chip.textContent = serialConnected ? 'CONNECTED' : state === 'error' ? 'ERROR' : 'NOT CONNECTED';
  chip.classList.toggle('active', serialConnected);
  byId('serConnect').disabled = serialConnected || !SerialReader.supported();
  byId('serDisconnect').disabled = !serialConnected;
  if (state === 'error') toast('Scoreboard: ' + detail, 'error');
  clearInterval(rateTimer);
  if (serialConnected) rateTimer = setInterval(() => { setText('serRate', `${frames} frames/sec`); frames = 0; }, 1000);
  else setText('serRate', '');
  renderSerialChip();
}
function renderSerialChip() {
  const on = serialConnected && byId('serApply').checked;
  byId('serialChip').hidden = !serialConnected;
  byId('serialChip').textContent = on ? 'SCOREBOARD → BUG' : 'SCOREBOARD (not sending)';
  byId('serialChip').classList.toggle('active', on);
}

let frameDrawAt = 0;
function onFrame(frame) {
  frames += 1;
  const now = Date.now();
  frame.forEach((b, i) => { if (lastFrame[i] !== b) changedAt[i] = now; });
  lastFrame = frame;
  if (now - frameDrawAt > 200) { frameDrawAt = now; renderFrame(); }
  if (liveDoc.ready && byId('serApply').checked) applyFrame(frame);
}

function renderFrame() {
  const now = Date.now();
  const mapped = new Set();
  Object.values(mapping.fields).forEach(f => { for (let i = 0; i < (f.length || 1); i++) mapped.add(Number(f.offset) + i); });
  byId('serFrame').innerHTML = lastFrame.map((b, i) => `<span data-i="${i}" class="${now - (changedAt[i] || 0) < 3000 ? 'hot' : ''} ${mapped.has(i) ? 'mapped' : ''}">${b.toString(16).padStart(2, '0')}</span>`).join('');
  setText('serAscii', 'ASCII: ' + lastFrame.map(b => (b >= 32 && b < 127 ? String.fromCharCode(b) : '·')).join(''));
  if (!liveDoc.ready) return;
  for (const [key, , kind] of serialFields()) {
    const cell = byId('dec-' + key);
    const f = mapping.fields[key];
    if (!cell) continue;
    if (!f) { cell.textContent = '—'; continue; }
    const value = interpret(kind, decodeRaw(lastFrame, f));
    cell.textContent = value === null ? '?' : kind === 'clock' ? clockText(value, true) : String(value);
  }
}

// Scoreboard → scorebug. Only fields that changed since the last frame are
// written, and changes are batched into one save at most every 300 ms.
let pending = null, pendingTimer = 0;
function queue(apply) {
  pending = pending ? [...pending, apply] : [apply];
  if (!pendingTimer) pendingTimer = setTimeout(() => {
    const batch = pending; pending = null; pendingTimer = 0;
    changeGame((g, d) => { batch.forEach(fn => fn(g, d)); });
  }, 300);
}

function applyFrame(frame) {
  const values = {};
  for (const [key, , kind] of serialFields()) {
    const f = mapping.fields[key];
    if (!f) continue;
    const value = interpret(kind, decodeRaw(frame, f));
    if (value === null) continue;
    values[key] = value;
  }
  const changed = key => key in values && lastDecoded[key] !== values[key];
  const sport = L().sport;
  for (const i of [0, 1]) {
    if (changed('score' + i)) { const v = clamp(values['score' + i], 0, 299); queue(g => { g.score[i] = v; }); }
    if (changed('timeouts' + i)) { const v = clamp(values['timeouts' + i], 0, 9); queue(g => { g.timeouts[i] = v; }); }
    if (sport === 'basketball' && changed('fouls' + i)) { const v = clamp(values['fouls' + i], 0, 99); queue(g => { g.fouls[i] = v; }); }
  }
  if (changed('period')) { const v = values.period; queue(g => { g.period = v; }); }
  if (changed('aux')) {
    const ms = clamp(values.aux, 0, 99) * 1000;
    queue(g => { const now = serverNow(); g.aux = ms > 0 && lastDecoded.aux > values.aux ? {ms, end: now + ms} : {ms, end: 0}; });
  }
  if (sport === 'football') {
    if (changed('down') && values.down >= 1 && values.down <= 4) { const v = values.down; queue(g => { g.down = v; }); }
    if (changed('distance')) { const v = String(values.distance).slice(0, 6); queue(g => { g.distance = /^g/i.test(v) ? 'Goal' : v; }); }
    if (changed('ballOn')) { const v = String(values.ballOn).slice(0, 12); queue(g => { g.ballOn = v; }); }
    if (changed('poss0') || changed('poss1')) { const v = values.poss0 ? 0 : values.poss1 ? 1 : -1; queue(g => { g.possession = v; }); }
  } else if (changed('arrow0') || changed('arrow1')) {
    const v = values.arrow0 ? 0 : values.arrow1 ? 1 : -1; queue(g => { g.arrow = v; });
  }
  // Game clock: from a text field or minutes/seconds/tenths fields.
  let clockMs = 'clock' in values ? values.clock : null;
  if (clockMs === null && ('clockMin' in values || 'clockSec' in values)) {
    clockMs = ((values.clockMin || 0) * 60 + (values.clockSec || 0)) * 1000 + (values.clockTenths || 0) * 100;
  }
  if (clockMs !== null) trackClock(clockMs);
  Object.assign(lastDecoded, values);
}

function trackClock(ms) {
  const now = Date.now();
  if (clockTrack.value === null) { clockTrack.value = ms; clockTrack.changedAt = now; }
  if (ms !== clockTrack.value) {
    clockTrack.running = ms < clockTrack.value;
    clockTrack.value = ms;
    clockTrack.changedAt = now;
  } else if (now - clockTrack.changedAt > 1500) clockTrack.running = false;
  const g = G();
  const at = serverNow();
  const shown = remaining(g.game, at);
  const isRunning = running(g.game, at);
  const drift = Math.abs(shown - ms);
  if (clockTrack.running !== isRunning || drift > (clockTrack.running ? 1100 : 90)) {
    const runningNow = clockTrack.running;
    queue(game => { const t = serverNow(); game.game = runningNow ? {ms, end: t + ms} : {ms, end: 0}; });
  }
}

function renderSerialProfiles() {
  const profiles = libraryDoc.doc?.serialProfiles || [];
  options(byId('serProfiles'), profiles.length ? profiles.map(p => [p.id, p.name]) : [['', 'No saved mappings']]);
}
byId('serSaveProfile').onclick = () => {
  const name = byId('serProfileName').value.trim();
  if (!name) { toast('Name the mapping first (e.g. "Home gym FairPlay").', 'error'); return; }
  libraryDoc.commit(lib => {
    lib.serialProfiles = lib.serialProfiles || [];
    const existing = lib.serialProfiles.find(p => p.name === name);
    if (existing) Object.assign(existing, {mapping: copy(mapping)});
    else lib.serialProfiles.push({id: uid(), name, mapping: copy(mapping)});
  }).then(() => toast('Mapping saved')).catch(fail);
};
byId('serLoad').onclick = () => {
  const profile = (libraryDoc.doc?.serialProfiles || []).find(p => p.id === byId('serProfiles').value);
  if (!profile) return;
  mapping = copy(profile.mapping);
  byId('serProfileName').value = profile.name;
  saveMapping();
  renderSerial();
  toast(`Loaded ${profile.name}`);
};
byId('serExport').onclick = () => download('scoreboard-mapping.json', JSON.stringify(mapping, null, 2), 'application/json');
byId('serImport').onchange = async event => {
  try {
    const data = JSON.parse(await event.target.files[0].text());
    if (typeof data !== 'object' || !data.fields) throw new Error('That file is not a scoreboard mapping.');
    mapping = {baud: 9600, start: '', end: '', length: 0, ...data};
    saveMapping();
    renderSerial();
  } catch (error) { fail(error); }
  event.target.value = '';
};

// ── Scoreboard camera feed (ScoreSight) ────────────────────────────────────
const ROLE_LABELS = {
  homeScore: 'Home score', awayScore: 'Away score', clock: 'Game clock', period: 'Period', aux: 'Play / shot clock',
  homeFouls: 'Home fouls', awayFouls: 'Away fouls', homeTimeouts: 'Home timeouts', awayTimeouts: 'Away timeouts',
  down: 'Down', distance: 'Yards to go', ballOn: 'Ball on', homePoss: 'Home possession', awayPoss: 'Away possession',
};
const FOOTBALL_ONLY = new Set(['down', 'distance', 'ballOn', 'homePoss', 'awayPoss']);
const feedDefaults = () => ({enabled: false, homeSide: 1, last: {}, track: null, raw: {}, seenAt: 0});

function renderFeed() {
  const feed = {...feedDefaults(), ...(L().feed || {})};
  byId('feedEnabled').checked = feed.enabled;
  if (document.activeElement !== byId('feedHome')) byId('feedHome').value = String(feed.homeSide);
  const age = feed.seenAt ? Math.round((serverNow() - feed.seenAt) / 1000) : null;
  const live = age !== null && age < 10;
  const state = byId('feedState');
  state.textContent = !feed.seenAt ? 'NO DATA YET' : live ? (feed.enabled ? 'RECEIVING → BUG' : 'RECEIVING (not sending)') : 'NO RECENT DATA';
  state.classList.toggle('active', live && feed.enabled);
  setText('feedSeen', feed.seenAt ? `Last reading ${age < 2 ? 'just now' : age + 's ago'}` : '');
  const rows = Object.entries(feed.raw || {});
  const body = byId('feedValues').tBodies[0];
  const key = JSON.stringify([rows, L().sport]);
  if (body.dataset.key === key) return;
  body.dataset.key = key;
  body.innerHTML = rows.length ? rows.map(([name, text]) => {
    const role = roleOf(name);
    const target = !role ? '<span class="muted">Not used. Rename the box to match a field.</span>'
      : FOOTBALL_ONLY.has(role) && L().sport !== 'football' ? `<span class="muted">${ROLE_LABELS[role]} (football only)</span>`
      : (role === 'homeFouls' || role === 'awayFouls') && L().sport !== 'basketball' ? `<span class="muted">${ROLE_LABELS[role]} (basketball only)</span>`
      : esc(ROLE_LABELS[role]);
    return `<tr><td>${esc(name)}</td><td class="num">${esc(text)}</td><td>${target}</td></tr>`;
  }).join('') : '<tr><td colspan="3" class="muted">Nothing received yet. Point ScoreSight at the feed URL.</td></tr>';
}
setInterval(() => { if (liveDoc.ready) renderFeed(); }, 1000);
byId('feedEnabled').onchange = event => change(d => {
  // Start fresh so every current reading is applied right away.
  d.feed = {...feedDefaults(), ...(d.feed || {}), enabled: event.target.checked, last: {}, track: null};
}, event.target.checked ? 'ScoreSight now drives the scorebug' : 'ScoreSight stopped sending to the scorebug');
byId('feedHome').onchange = event => change(d => { d.feed = {...feedDefaults(), ...(d.feed || {}), homeSide: Number(event.target.value), last: {}}; });
byId('feedCopy').onclick = () => copyText(byId('feedUrl').value, 'Feed URL');

// ── Keyboard ────────────────────────────────────────────────────────────────
byId('keysOn').checked = local.get('keys', false);
byId('keysOn').onchange = event => local.set('keys', event.target.checked);
addEventListener('keydown', event => {
  if (!byId('keysOn').checked || !liveDoc.ready || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target.closest('input, select, textarea, dialog')) return;
  const actions = {
    ' ': () => toggleClock('game'), x: () => toggleClock('aux'), r: () => resetAux('40'), b: () => change(d => { d.bugVisible = !d.bugVisible; }),
    Escape: () => change(d => { d.graphic = null; d.banner = null; }), 1: () => addPoints(0, 1), 2: () => addPoints(1, 1),
  };
  const action = actions[event.key.length === 1 ? event.key.toLowerCase() : event.key];
  if (action) { event.preventDefault(); action(); }
});

// ── Render + startup ────────────────────────────────────────────────────────
function render() {
  if (!liveDoc.ready) return;
  renderLive();
  renderStyle();
  if (!draftLoaded) { draftLoaded = true; loadDraftForm(); }
  else options(byId('gSide'), sideOptions());
  if (!teamsDirty) renderTeamEditors();
  renderStatsLinks();
  renderFeed();
  if (!byId('serMap').tBodies[0].children.length || byId('serMap').dataset.sport !== L().sport) {
    byId('serMap').dataset.sport = L().sport;
    renderSerial();
  }
}

onConnection(online => {
  const element = byId('connection');
  element.textContent = online ? 'Connected' : 'Offline — retrying';
  element.classList.toggle('online', online);
});

byId('signOut').onclick = signOut;

(async () => {
  try {
    const session = await getSession();
    if (!session) return;
    overlayKey = session.overlayKey;
    feedKey = session.feedKey;
    byId('feedUrl').value = new URL('/api/feed?key=' + feedKey, location.origin).href;
    await Promise.all([liveDoc.start(), tickerDoc.start(), libraryDoc.start(), statsDoc.start()]);
    if (!liveDoc.ready) throw new Error('Could not load the game. Check the database connection and reload.');
    byId('app').hidden = false;
    setTab(local.get('tab', 'live'));
    const url = overlayUrl(overlayKey);
    byId('preview').src = url;
    byId('openOverlay').href = url;
    byId('copyOverlayTop').onclick = () => copyText(url, 'OBS overlay URL');
    renderObsLinks();
    render();
    renderTicker(true);
    renderLibrary();
  } catch (error) {
    const box = byId('startupError');
    box.hidden = false;
    box.textContent = error.message;
  }
})();
