// Spotting boards: printable rosters for the announcers, built from the teams
// and rosters saved in the Team builder. Football prints one page per team (by
// number, or offense / defense); basketball fits both teams on one page.
// Details added here (pronunciation, height/weight, notes, coach) save to the
// saved roster, so they're there the next time these teams play.
import {$$, byId, Doc, esc, getSession, onConnection, photoPosition, readable, setText, shade, toast, validImage} from './common.js';
import {CLASSES} from './stat-graphics.js';
import {PAPER, byNumber, footballGroups, gridShape, splitName} from './spotting-layout.js';

const libraryDoc = new Doc('library', {onChange: () => { renderAll(); }, interval: 6000});
const liveDoc = new Doc('live', {interval: 15000});
const fail = error => toast(error.message || String(error), 'error');
const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const local = {
  get: (key, fallback) => { try { const v = localStorage.getItem('studio.spot.' + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set: (key, value) => { try { localStorage.setItem('studio.spot.' + key, JSON.stringify(value)); } catch {} },
};
const opts = {
  sport: 'football', left: '', right: '', layout: local.get('layout', 'number'), pages: local.get('pages', 'together'), paper: local.get('paper', 'letter'),
  say: local.get('say', true), size: local.get('size', true), notes: local.get('notes', true), photos: local.get('photos', false),
};
let editSide = 0;

const teams = () => libraryDoc.doc?.teams || [];
const teamById = id => teams().find(t => t.id === id) || null;
const rosterOf = (team, sport) => (libraryDoc.doc?.rosters || []).find(r => r.sport === sport && sameName(r.name, team.name));
const playersOf = (team, sport) => rosterOf(team, sport)?.players || [];
const playerKey = (p, i) => p.id || 'i' + i;
const classOf = cls => {
  const key = String(cls || '').toUpperCase().replace('.', '');
  return {FR: 'Fr', SO: 'So', JR: 'Jr', SR: 'Sr', 9: 'Fr', 10: 'So', 11: 'Jr', 12: 'Sr'}[key] || (CLASSES[key] ? key : String(cls || ''));
};
const sizeOf = p => [p.ht, p.wt && `${p.wt}`].filter(Boolean).join(' · ');

function colors(element, team, suffix = '') {
  const color = team?.color || '#323a46';
  element.style.setProperty('--c' + suffix, color);
  element.style.setProperty('--cd' + suffix, shade(color, 0.62));
  element.style.setProperty('--ci' + suffix, readable(color));
  element.style.setProperty('--ca' + suffix, team?.accent || '#999999');
}
function logoMarkup(team) {
  return validImage(team?.logo) ? `<img src="${esc(team.logo)}" alt=""${team.logoBacking ? ' class="backed"' : ''}>` : `<span>${esc(team?.short || '')}</span>`;
}
const teamLine = team => [team.record, team.rank && `#${String(team.rank).replace('#', '')}`, team.spot?.coach && `Coach ${team.spot.coach}`].filter(Boolean).join(' · ');

// ── Photos (basketball) ─────────────────────────────────────────────────────
const photos = new Map();
function photo(ref) {
  if (!ref) return '';
  if (validImage(ref)) return ref;
  if (photos.has(ref)) return photos.get(ref);
  photos.set(ref, '');
  fetch('/api/doc?key=' + encodeURIComponent(ref), {cache: 'no-store'}).then(r => (r.ok ? r.json() : null)).then(packet => {
    if (packet?.doc?.data) { photos.set(ref, packet.doc.data); renderSheets(); }
  }).catch(() => {});
  return '';
}

// ── Pages ───────────────────────────────────────────────────────────────────
function sheet(paper) {
  const element = document.createElement('section');
  element.className = 'sheet';
  element.style.setProperty('--w', paper.w + 'in');
  element.style.setProperty('--h', paper.h + 'in');
  return element;
}
function footer(element, label) {
  const date = new Date().toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'});
  element.insertAdjacentHTML('beforeend', `<footer class="sf"><span>${esc(label)}</span><span>Printed ${esc(date)} · Broadcast Studio</span></footer>`);
}
function teamHeader(element, team, tag) {
  element.insertAdjacentHTML('beforeend', `<header class="sh"><div class="shLogo">${logoMarkup(team)}</div>
    <div class="shText"><h1>${esc(team.name)}</h1><p>${esc(teamLine(team))}</p></div>
    <div class="shNotes">${esc(team.spot?.notes || '')}</div><div class="shTag">${esc(tag)}</div></header>`);
}

function box(p) {
  const {first, last} = splitName(p.name);
  const meta = [p.pos && `<span class="pos">${esc(p.pos)}</span>`, esc(classOf(p.cls)), opts.size && esc(sizeOf(p))].filter(Boolean).join(' · ');
  return `<div class="box${String(p.num).length > 2 ? ' long' : ''}"><div class="num">${esc(p.num || '–')}</div><div class="who">
    <div class="nm"><b>${esc(last)}</b> ${esc(first)}</div>
    ${meta ? `<div class="meta">${meta}</div>` : ''}
    ${opts.say && p.say ? `<div class="say">${esc(p.say)}</div>` : ''}
    ${opts.notes && p.note ? `<div class="note">${esc(p.note)}</div>` : ''}</div></div>`;
}
// The number of text lines a box shows, so the boxes can be tall enough.
const lines = players => 1 + Math.max(0, ...players.map(p => Boolean(p.pos || p.cls || (opts.size && sizeOf(p))) + Boolean(opts.say && p.say) + Boolean(opts.notes && p.note)));
function grid(players, w, h, tight = false) {
  const many = lines(players);
  const shape = gridShape(players.length, w, h, {ratio: many > 2 ? 2.7 : 3.2, minHeight: tight ? 0.42 : many > 2 ? 0.5 : 0.42, minWidth: 1.6});
  return `<div class="grid" style="--cols:${shape.cols};--rows:${shape.rows};--bh:${(shape.boxH - 0.045).toFixed(3)}in">${players.map(box).join('')}</div>`;
}

function footballSheets(team, paper) {
  const players = playersOf(team, 'football');
  const element = sheet(paper);
  colors(element, team);
  teamHeader(element, team, opts.layout === 'units' ? 'Football · Offense / Defense' : 'Football · Spotting board');
  const areaW = paper.w - 0.6;
  const areaH = paper.h - 0.6 - 0.85 - 0.18 - 0.2;
  const area = document.createElement('div');
  area.className = 'area';
  if (!players.length) area.innerHTML = `<p class="empty">No football roster saved for ${esc(team.name)}. Add one in the Team builder.</p>`;
  else if (opts.layout !== 'units') area.innerHTML = grid(byNumber(players), areaW, areaH);
  else {
    const groups = footballGroups(players);
    const extra = [...groups.special, ...groups.other.filter(p => !groups.special.includes(p))];
    const stripCols = paper.w > 12 ? 8 : 6;
    const stripRows = extra.length ? Math.ceil(extra.length / stripCols) : 0;
    const stripBox = 0.44;
    const stripH = stripRows ? stripRows * (stripBox + 0.045) + 0.27 : 0;
    const unitW = (areaW - 0.15) / 2;
    const unitH = areaH - stripH - (stripH ? 0.1 : 0) - 0.27;
    const unit = (label, list) => `<div class="unit"><div class="unitHead">${label}<span>${list.length}</span></div>${list.length ? grid(list, unitW, unitH, true) : '<p class="empty">No players with these positions</p>'}</div>`;
    area.innerHTML = `<div class="units">${unit('Offense', groups.offense)}${unit('Defense', groups.defense)}</div>` +
      (stripRows ? `<div class="strip"><div class="unitHead">Specialists${groups.other.length ? ' &amp; others' : ''}<span>${extra.length}</span></div>
        <div class="grid" style="--cols:${stripCols};--rows:${stripRows};--bh:${stripBox}in;grid-auto-flow:row">${extra.map(box).join('')}</div></div>` : '');
  }
  element.append(area);
  footer(element, `${team.name} football`);
  return [element];
}

function bbTeamBlock(team, rowHeight, withHead) {
  const players = byNumber(playersOf(team, 'basketball'));
  const photosOn = opts.photos && players.some(p => p.photo);
  const head = withHead ? `<div class="bbHead"><div class="shLogo">${logoMarkup(team)}</div><b>${esc(team.name)}</b><small>${esc(teamLine(team))}</small></div>` : '';
  const notes = withHead && team.spot?.notes ? `<div class="bbNotes">${esc(team.spot.notes)}</div>` : '';
  const rows = players.map(p => {
    const {first, last} = splitName(p.name);
    const src = photosOn ? photo(p.photo) : '';
    const sub = opts.say && p.say ? `${esc(first)} · <i>${esc(p.say)}</i>` : esc(first);
    return `<tr><td class="n">${esc(p.num)}</td>${photosOn ? `<td class="ph">${src ? `<img src="${esc(src)}" alt="" style="object-position:${esc(photoPosition(p.photoPos))}">` : ''}</td>` : ''}
      <td class="pl"><b>${esc(last)}</b><span>${sub}</span></td>
      <td class="s">${esc(p.pos || '')}</td><td class="s">${esc(classOf(p.cls))}</td>${opts.size ? `<td class="s ht">${esc(p.ht || '')}</td>` : ''}
      <td class="nt">${opts.notes ? esc(p.note || '') : ''}</td></tr>`;
  }).join('');
  const table = players.length
    ? `<table class="bbTable" style="--rh:${rowHeight.toFixed(3)}in"><thead><tr><th class="n hd">#</th>${photosOn ? '<th class="ph"></th>' : ''}<th class="pl">Player</th><th class="s">Pos</th><th class="s">Yr</th>${opts.size ? '<th class="s ht">Ht</th>' : ''}<th>Notes</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="empty">No basketball roster saved for ${esc(team.name)}.</p>`;
  const block = document.createElement('div');
  block.className = 'bbTeam';
  colors(block, team);
  block.innerHTML = head + notes + table;
  return block;
}

function basketballSheets(list, paper) {
  const areaH = paper.h - 0.6 - 0.85 - 0.18 - 0.2;
  const make = (group, together) => {
    const element = sheet(paper);
    if (together) {
      const [a, b] = group;
      colors(element, a, '0'); colors(element, b, '1');
      element.insertAdjacentHTML('beforeend', `<header class="sh game"><div class="shLogo">${logoMarkup(a)}</div>
        <div class="shText"><h1>${esc(a.name)} vs ${esc(b.name)}</h1><p>Basketball · Spotting board</p></div><div class="shLogo">${logoMarkup(b)}</div></header>`);
    } else {
      colors(element, group[0]);
      teamHeader(element, group[0], 'Basketball · Spotting board');
    }
    const most = Math.max(1, ...group.map(t => playersOf(t, 'basketball').length));
    const headH = together ? 0.55 + (group.some(t => t.spot?.notes) ? 0.2 : 0) : 0;
    const rowHeight = Math.min(0.68, Math.max(0.3, (areaH - headH - 0.34) / most));
    const cols = document.createElement('div');
    cols.className = 'bbCols area';
    cols.style.setProperty('--teams', group.length);
    group.forEach(team => cols.append(bbTeamBlock(team, rowHeight, together)));
    element.append(cols);
    footer(element, together ? `${group[0].name} vs ${group[1].name} basketball` : `${group[0].name} basketball`);
    return element;
  };
  if (list.length === 2 && opts.pages === 'together') return [make(list, true)];
  return list.map(team => make([team], false));
}

function renderSheets() {
  const host = byId('sheets');
  if (!libraryDoc.ready) return;
  const paper = PAPER[opts.paper] || PAPER.letter;
  byId('pageSize').textContent = `@page{size:${paper.w}in ${paper.h}in;margin:0}`;
  const list = [teamById(opts.left), teamById(opts.right)].filter(Boolean);
  const pages = !list.length ? []
    : opts.sport === 'football' ? list.flatMap(team => footballSheets(team, paper)) : basketballSheets(list, paper);
  host.replaceChildren(...pages);
  if (!pages.length) host.innerHTML = `<p class="muted noprint" style="margin:30px">${teams().length ? 'Pick a team above.' : 'No saved teams yet. Build teams and rosters in the control panel\'s Team builder.'}</p>`;
  const counts = list.map(t => `${t.name}: ${playersOf(t, opts.sport).length}`).join(' · ');
  setText('spInfo', list.length ? `${pages.length} page${pages.length === 1 ? '' : 's'} · ${counts} players` : '');
  fitZoom();
  fitNames(host);
}
// Long names: shorten the first name to an initial, then shrink the last name.
function fitNames(host) {
  host.querySelectorAll('.nm').forEach(line => {
    if (line.scrollWidth <= line.clientWidth + 1) return;
    const last = line.querySelector('b');
    const first = line.lastChild;
    if (first?.nodeType === 3 && first.textContent.trim().length > 2) first.textContent = ` ${first.textContent.trim()[0]}.`;
    let scale = 1;
    while (line.scrollWidth > line.clientWidth + 1 && scale > 0.66) {
      scale -= 0.06;
      last.style.fontSize = `calc(var(--bh) * ${(0.33 * scale).toFixed(3)})`;
    }
  });
}
function fitZoom() {
  const paper = PAPER[opts.paper] || PAPER.letter;
  const z = Math.min(1, (innerWidth - 40) / (paper.w * 96));
  byId('sheets').style.setProperty('--z', z.toFixed(3));
}
addEventListener('resize', fitZoom);

// ── Controls ────────────────────────────────────────────────────────────────
function renderControls() {
  document.body.classList.toggle('football', opts.sport === 'football');
  document.body.classList.toggle('basketball', opts.sport === 'basketball');
  $$('#spSport [data-sport]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sport === opts.sport)));
  const choices = [['', '— None —'], ...teams().map(t => [t.id, t.name])];
  for (const [id, key] of [['spLeft', 'left'], ['spRight', 'right']]) {
    const select = byId(id);
    const signature = JSON.stringify(choices);
    if (select.dataset.options !== signature) {
      select.replaceChildren(...choices.map(([value, label]) => new Option(label, value)));
      select.dataset.options = signature;
    }
    select.value = opts[key];
  }
  byId('spLayout').value = opts.layout; byId('spPages').value = opts.pages; byId('spPaper').value = opts.paper;
  for (const key of ['say', 'size', 'notes', 'photos']) byId('sp' + key[0].toUpperCase() + key.slice(1)).checked = opts[key];
}
byId('spSport').onclick = event => {
  const sport = event.target.closest('[data-sport]')?.dataset.sport;
  if (!sport) return;
  opts.sport = sport;
  renderAll(true);
};
byId('spLeft').onchange = event => { opts.left = event.target.value; renderAll(true); };
byId('spRight').onchange = event => { opts.right = event.target.value; renderAll(true); };
for (const [id, key] of [['spLayout', 'layout'], ['spPages', 'pages'], ['spPaper', 'paper']]) {
  byId(id).onchange = event => { opts[key] = event.target.value; local.set(key, opts[key]); renderSheets(); };
}
for (const key of ['say', 'size', 'notes', 'photos']) {
  byId('sp' + key[0].toUpperCase() + key.slice(1)).onchange = event => { opts[key] = event.target.checked; local.set(key, opts[key]); renderSheets(); };
}
byId('spPrint').onclick = () => window.print();

// ── Details editor ──────────────────────────────────────────────────────────
const LIMITS = {num: 3, name: 40, pos: 6, cls: 10, ht: 8, wt: 5, say: 60, note: 90};
let editorKey = '';
function renderEditor(force = false) {
  const sides = [teamById(opts.left), teamById(opts.right)];
  if (!sides[editSide] && sides[1 - editSide]) editSide = 1 - editSide;
  const team = sides[editSide];
  byId('editor').hidden = !team;
  setText('edSide0', sides[0]?.name || 'Left');
  setText('edSide1', sides[1]?.name || 'Right');
  byId('edSide0').disabled = !sides[0];
  byId('edSide1').disabled = !sides[1];
  $$('#edSide [data-side]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.side) === editSide)));
  if (!team) return;
  // Rebuild the table only when the team, sport or roster size changes, so typing isn't interrupted.
  const players = playersOf(team, opts.sport);
  const key = JSON.stringify([team.id, opts.sport, players.map((p, i) => playerKey(p, i))]);
  const typing = byId('editor').contains(document.activeElement);
  if (!force && key === editorKey && typing) return;
  if (document.activeElement !== byId('edCoach')) byId('edCoach').value = team.spot?.coach || '';
  if (document.activeElement !== byId('edTeamNotes')) byId('edTeamNotes').value = team.spot?.notes || '';
  if (!force && key === editorKey) {
    $$('#edTable [data-k]').forEach(input => {
      if (input === document.activeElement) return;
      const p = players.find((x, i) => playerKey(x, i) === input.closest('tr').dataset.key);
      if (p) input.value = p[input.dataset.k] || '';
    });
    return;
  }
  editorKey = key;
  const body = $$('#edTable tbody')[0];
  body.innerHTML = players.length ? byNumber(players.map((p, i) => ({...p, _key: playerKey(p, i)}))).map((p, row) => `<tr data-key="${esc(p._key)}">${
    ['num', 'name', 'pos', 'cls', 'ht', 'wt', 'say', 'note'].map(k => `<td><input data-k="${k}" maxlength="${LIMITS[k]}" value="${esc(p[k] || '')}" aria-label="${k}"${
      row === 0 && k === 'say' ? ' placeholder="JAY-len"' : row === 0 && k === 'ht' ? ' placeholder="6-2"' : ''}></td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="8" class="muted">No ${opts.sport} roster saved for ${esc(team.name)}. Add one in the control panel's Team builder.</td></tr>`;
  $$('#edTable [data-k]').forEach(input => {
    input.onchange = () => savePlayer(team, input.closest('tr').dataset.key, input.dataset.k, input.value);
  });
}
byId('edSide').onclick = event => {
  const side = event.target.closest('[data-side]')?.dataset.side;
  if (side === undefined) return;
  editSide = Number(side);
  renderEditor(true);
};
function saved() { setText('edSaved', 'Saved'); setTimeout(() => setText('edSaved', ''), 1500); }
function savePlayer(team, key, field, value) {
  libraryDoc.commit(lib => {
    const roster = (lib.rosters || []).find(r => r.sport === opts.sport && sameName(r.name, team.name));
    const player = roster?.players.find((p, i) => playerKey(p, i) === key);
    if (!player) return false;
    const clean = value.trim().slice(0, LIMITS[field]);
    if (field === 'name' && !clean) return false;
    player[field] = clean;
  }).then(ok => { if (ok) { saved(); renderSheets(); } }).catch(fail);
}
function saveTeam(field, value) {
  const team = [teamById(opts.left), teamById(opts.right)][editSide];
  if (!team) return;
  libraryDoc.commit(lib => {
    const target = lib.teams.find(t => t.id === team.id);
    if (!target) return false;
    target.spot = {...(target.spot || {}), [field]: value.trim().slice(0, field === 'coach' ? 60 : 200)};
  }).then(ok => { if (ok) { saved(); renderSheets(); } }).catch(fail);
}
byId('edCoach').onchange = event => saveTeam('coach', event.target.value);
byId('edTeamNotes').onchange = event => saveTeam('notes', event.target.value);

function renderAll(force = false) {
  if (!libraryDoc.ready) return;
  renderControls();
  renderSheets();
  renderEditor(force);
}

onConnection(online => {
  const element = byId('connection');
  element.textContent = online ? 'Connected' : 'Offline — retrying';
  element.classList.toggle('online', online);
});

(async () => {
  try {
    if (!await getSession()) return;
    await Promise.all([libraryDoc.start(), liveDoc.start()]);
    if (!libraryDoc.ready) throw new Error('Could not load your teams. Check the connection and reload.');
    // Start with today's game from the scorebug.
    const live = liveDoc.doc;
    opts.sport = live?.sport === 'basketball' ? 'basketball' : 'football';
    const find = name => teams().find(t => sameName(t.name, name))?.id || '';
    opts.left = find(live?.teams?.[0]?.name);
    opts.right = find(live?.teams?.[1]?.name);
    if (!opts.left && !opts.right && teams().length) opts.left = teams()[0].id;
    byId('app').hidden = false;
    renderAll(true);
  } catch (error) {
    const box = byId('startupError');
    box.hidden = false;
    box.textContent = error.message;
  }
})();
