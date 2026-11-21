import {$, $$, byId, clockText, copy, Doc, download, esc, getSession, onConnection, PHOTO_X, PHOTO_Y, photoPosition, readImage, remaining, serverNow, setText, toast, uid, validImage} from './common.js';
import {boxScore, compareRows, describe, lineScore, parseRoster, points, score, statLine, teamFouls} from './stats-engine.js';
import {defaultStats} from './defaults.js';
import {pdfText} from './roster-import.js';
import {createStatEntry} from './stat-entry.js';
import {boxCsv, renderBoxScore, renderPlays} from './box-view.js';

const statsDoc = new Doc('stats', {onChange: () => render(), interval: 2000});
const liveDoc = new Doc('live', {onChange: () => renderSync(), interval: 1000});
const libraryDoc = new Doc('library', {onChange: () => renderRosters(), interval: 8000});
const S = () => statsDoc.doc;
const L = () => liveDoc.doc;
const fail = error => toast(error.message || String(error), 'error');
const other = team => 1 - team;

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
// Inside the control panel (Box score & plays tab), plays are entered on the
// control panel's Live tab, so this page's Live tab is hidden there.
const EMBED = document.documentElement.classList.contains('embed');
function setTab(tab) {
  if (EMBED && tab === 'live') tab = 'box';
  $$('nav.tabs [data-tab]').forEach(b => { if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  ['live', 'rosters', 'box', 'pbp'].forEach(name => { byId('tab-' + name).hidden = name !== tab; });
  local.set(EMBED ? 'statsTabEmbed' : 'statsTab', tab);
  render();
}
$$('nav.tabs [data-tab]').forEach(b => { b.onclick = () => setTab(b.dataset.tab); });

// ── Time stamps from the scorebug ───────────────────────────────────────────
const teamName = i => (liveDoc.ready ? L().teams[i].name : ['Left', 'Right'][i]);
const teamShort = i => (liveDoc.ready ? L().teams[i].short : ['L', 'R'][i]);

// Play entry (players, action pad, last plays) is shared with the control panel.
const entry = createStatEntry({statsDoc, liveDoc, fail, afterChange: () => render(),
  els: {side0: byId('side0'), side1: byId('side1'), selected: byId('selected'), actions: byId('actions'), recent: byId('recent')},
  fallbackPeriod: () => byId('ownPeriod').value || '1st'});
const linked = () => entry.linked();
const sendToBug = force => entry.sendToBug(force);

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
  bar.hidden = !differs || entry.sending;
  byId('setBug').hidden = false; byId('switchBug').hidden = true;
  if (differs) setText('mismatchText', `Scorebug shows ${g.score[0]}–${g.score[1]}, stats have ${s[0]}–${s[1]}.`);
}
setInterval(() => { if (linked()) renderSync(); }, 500);

byId('setBug').onclick = () => sendToBug(true);
byId('undo').onclick = () => entry.undo();
byId('switchBug').onclick = () => liveDoc.commit(d => { d.sport = S().sport; }).catch(fail);
byId('autoSend').onchange = event => statsDoc.commit(s => { s.autoSend = event.target.checked; }).catch(fail);

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
const teamViews = {name: i => teamName(i), short: i => teamShort(i), color: i => (liveDoc.ready ? L().teams[i].color : '#888')};
function renderBox() { renderBoxScore(byId('boxScore'), S(), teamViews, playerOnAir); }

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
byId('exportCsv').onclick = () => download(`box-score-${S().sport}-${new Date().toISOString().slice(0, 10)}.csv`, boxCsv(S(), teamViews), 'text/csv');

// ── Play-by-play ────────────────────────────────────────────────────────────
function renderPbp() {
  renderPlays(byId('pbp'), S(), teamViews, id => statsDoc.commit(st => { st.events = st.events.filter(e => e.id !== id); }).then(() => sendToBug()).catch(fail));
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
  if (!byId('tab-live').hidden) entry.render();
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
    setTab(EMBED ? local.get('statsTabEmbed', 'box') : local.get('statsTab', 'live'));
  } catch (error) {
    const box = byId('startupError');
    box.hidden = false;
    box.textContent = error.message;
  }
})();
