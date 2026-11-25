// Team builder: create and edit saved teams (name, abbreviation, ranking,
// record, colors, logo, and a roster for each sport) without putting them on
// the scorebug. Teams live in the library doc; rosters are in the library's
// roster list, matched to the team by name (the same rosters the stat keeper's
// "Save roster" button writes).
import {$, $$, byId, copy, Doc, esc, hexColor, PHOTO_X, PHOTO_Y, photoPosition, readImage, readable, shade, toast, uid, validImage} from './common.js';
import {parseRoster} from './stats-engine.js';
import {pdfText} from './roster-import.js';

const SPORTS = ['basketball', 'football'];
const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const blank = () => ({id: null, name: '', short: '', rank: '', record: '', color: '#323a46', accent: '#f2a900', logo: '', logoBacking: false,
  rosters: {basketball: [], football: []}});

export function initTeamBuilder({libraryDoc, liveDoc, statsDoc, change, cleanTeam, confirmBox, fail, loadProfile, photoData}) {
  let draft = null;        // the team being edited
  let savedName = '';      // its name as last saved (to follow renames)
  let dirty = false;
  let sport = liveDoc.doc?.sport === 'football' ? 'football' : 'basketball';
  const photos = new Map();

  const teams = () => libraryDoc.doc?.teams || [];
  const rosterOf = (name, s) => (libraryDoc.doc?.rosters || []).find(r => r.sport === s && sameName(r.name, name));
  const fromLibrary = team => ({...blank(), ...copy(team),
    rosters: Object.fromEntries(SPORTS.map(s => [s, copy(rosterOf(team.name, s)?.players || [])]))});

  function setDirty(value = true) {
    dirty = value;
    byId('bDirty').textContent = dirty ? 'Unsaved changes' : '';
  }
  async function okToLeave() {
    return !dirty || confirmBox('Leave without saving?', `Changes to ${draft.name || 'this team'} haven't been saved.`, 'Leave');
  }

  // ── Team list ──
  function renderList() {
    const query = byId('bSearch').value.trim().toLowerCase();
    const list = teams().filter(t => !query || t.name.toLowerCase().includes(query) || t.short.toLowerCase().includes(query));
    const box = byId('bTeams');
    if (!teams().length) { box.innerHTML = '<p class="muted">No saved teams yet. Press "+ New team".</p>'; return; }
    if (!list.length) { box.innerHTML = '<p class="muted">No teams match.</p>'; return; }
    box.replaceChildren(...list.map(team => {
      const counts = SPORTS.map(s => [s, rosterOf(team.name, s)?.players.length || 0]).filter(([, n]) => n)
        .map(([s, n]) => `${n} ${s === 'basketball' ? 'BB' : 'FB'}`);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'bTeam';
      row.setAttribute('aria-current', String(draft?.id === team.id));
      row.innerHTML = `${validImage(team.logo) ? `<img src="${esc(team.logo)}" alt="">` : `<i class="swatch" style="--c:${esc(team.color)}"></i>`}
        <span><strong>${esc(team.name)}</strong><small>${esc([team.short, team.record, counts.length ? counts.join(' · ') + ' players' : 'no roster'].filter(Boolean).join(' · '))}</small></span>`;
      row.onclick = async () => { if (draft?.id !== team.id && await okToLeave()) open(fromLibrary(team)); };
      return row;
    }));
  }

  // ── Editor ──
  function open(next) {
    draft = next;
    savedName = next.id ? next.name : '';
    setDirty(false);
    byId('bEmpty').hidden = true;
    byId('bForm').hidden = false;
    byId('bDelete').hidden = !draft.id;
    byId('bName').value = draft.name;
    byId('bShort').value = draft.short;
    byId('bRank').value = draft.rank || '';
    byId('bRecord').value = draft.record || '';
    byId('bBacking').checked = Boolean(draft.logoBacking);
    renderColors();
    renderPreview();
    renderRoster();
    renderList();
    if (!draft.id) byId('bName').focus();
  }
  function renderColors() {
    for (const [key, id] of [['color', 'bColor'], ['accent', 'bAccent']]) {
      byId(id).value = draft[key];
      byId(id + 'Hex').value = draft[key];
    }
  }
  function renderPreview() {
    const preview = byId('bPreview');
    preview.style.cssText = `--t:${draft.color};--td:${shade(draft.color, 0.72)};--ti:${readable(draft.color)};--ta:${draft.accent}`;
    const img = $('img', preview);
    img.hidden = !validImage(draft.logo);
    if (validImage(draft.logo)) img.src = draft.logo;
    $('strong', preview).textContent = draft.name || 'New team';
    byId('bTitle').textContent = draft.id ? draft.name || 'Team' : 'New team';
    byId('bShort').placeholder = (draft.name.trim().slice(0, 3) || 'ABC').toUpperCase(); // used if left blank
    byId('bRemoveLogo').disabled = !draft.logo;
  }

  const players = () => draft.rosters[sport];
  function renderRoster() {
    $$('#bSport [data-sport]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sport === sport)));
    byId('bCount').textContent = `${players().length} ${sport} players`;
    const list = byId('bRoster');
    list.innerHTML = players().map(p => `<div class="rosterRow" data-id="${esc(p.id)}">${p.photo
      ? '<button type="button" class="thumb" title="Photo and alignment" data-thumb></button>'
      : '<label class="thumb" title="Add photo">＋<input type="file" accept="image/*" hidden data-photo></label>'}
      <input data-k="num" value="${esc(p.num)}" maxlength="3" placeholder="#" aria-label="Number"><input data-k="name" value="${esc(p.name)}" maxlength="40" placeholder="Name" aria-label="Name">
      <input data-k="pos" value="${esc(p.pos || '')}" maxlength="6" placeholder="Pos" aria-label="Position"><input data-k="cls" value="${esc(p.cls || '')}" maxlength="10" placeholder="Yr" aria-label="Year">
      <button type="button" class="ghost" data-del aria-label="Remove player">✕</button></div>`).join('')
      || `<p class="muted">No ${sport} roster yet. Paste players, import a PDF or CSV, or add them one at a time.</p>`;
    $$('.rosterRow', list).forEach(row => {
      const player = players().find(p => p.id === row.dataset.id);
      $$('[data-k]', row).forEach(input => { input.oninput = () => { player[input.dataset.k] = input.value; setDirty(); }; });
      $('[data-del]', row).onclick = () => { draft.rosters[sport] = players().filter(p => p !== player); setDirty(); renderRoster(); };
      if (player.photo) {
        photoSrc(player.photo).then(src => {
          if (!src) return;
          const img = document.createElement('img');
          img.src = src; img.alt = ''; img.style.objectPosition = photoPosition(player.photoPos);
          $('.thumb', row).replaceChildren(img);
        });
        $('[data-thumb]', row).onclick = () => openPhoto(player);
      } else {
        $('[data-photo]', row).onchange = async event => {
          try { await uploadPhoto(player, event.target.files[0]); renderRoster(); openPhoto(player); } catch (error) { fail(error); }
        };
      }
    });
  }

  // ── Player photos (stored as their own docs, like the stat keeper does) ──
  async function photoSrc(ref) {
    if (validImage(ref)) return ref;
    if (!photos.has(ref)) photos.set(ref, await photoData(ref));
    return photos.get(ref);
  }
  async function uploadPhoto(player, file) {
    const data = await readImage(file, {maxWidth: 420, maxHeight: 420, type: 'image/jpeg', quality: 0.84});
    const key = 'photo:' + uid();
    const doc = new Doc(key);
    doc.packet = {session: libraryDoc.packet.session, revision: 0, doc: {}};
    await doc.commit(d => { d.data = data; });
    photos.set(key, data);
    player.photo = key;
    player.photoPos = 'center top';
    setDirty();
  }
  let photoPlayer = null;
  async function openPhoto(player) {
    photoPlayer = player;
    byId('bPhotoTitle').textContent = `${player.num ? '#' + player.num + ' ' : ''}${player.name}`;
    const [x, y] = photoPosition(player.photoPos).split(' ');
    byId('bPhotoX').replaceChildren(...PHOTO_X.map(([value, label]) => new Option(label, value)));
    byId('bPhotoY').replaceChildren(...PHOTO_Y.map(([value, label]) => new Option(label, value)));
    byId('bPhotoX').value = x;
    byId('bPhotoY').value = y;
    byId('bPhotoImg').style.objectPosition = `${x} ${y}`;
    byId('bPhotoImg').src = (await photoSrc(player.photo)) || '';
    if (!byId('bPhotoDialog').open) byId('bPhotoDialog').showModal();
  }
  ['bPhotoX', 'bPhotoY'].forEach(id => {
    byId(id).onchange = () => {
      photoPlayer.photoPos = `${byId('bPhotoX').value} ${byId('bPhotoY').value}`;
      byId('bPhotoImg').style.objectPosition = photoPlayer.photoPos;
      setDirty();
      renderRoster();
    };
  });
  byId('bPhotoReplace').onchange = async event => {
    try { await uploadPhoto(photoPlayer, event.target.files[0]); renderRoster(); openPhoto(photoPlayer); } catch (error) { fail(error); }
    event.target.value = '';
  };
  byId('bPhotoRemove').onclick = () => {
    photoPlayer.photo = '';
    delete photoPlayer.photoPos;
    byId('bPhotoDialog').close();
    setDirty();
    renderRoster();
  };

  // ── Form inputs ──
  for (const [id, key] of [['bName', 'name'], ['bShort', 'short'], ['bRank', 'rank'], ['bRecord', 'record']]) {
    byId(id).oninput = () => { draft[key] = byId(id).value; setDirty(); renderPreview(); };
  }
  for (const [id, key] of [['bColor', 'color'], ['bAccent', 'accent']]) {
    byId(id).oninput = () => { draft[key] = byId(id).value; byId(id + 'Hex').value = draft[key]; setDirty(); renderPreview(); };
    byId(id + 'Hex').oninput = () => {
      const value = hexColor(byId(id + 'Hex').value);
      if (!value) return;
      draft[key] = value; byId(id).value = value; setDirty(); renderPreview();
    };
  }
  byId('bBacking').onchange = () => { draft.logoBacking = byId('bBacking').checked; setDirty(); };
  byId('bLogo').onchange = async event => {
    try {
      draft.logo = await readImage(event.target.files[0], {maxWidth: 256, maxHeight: 256});
      setDirty(); renderPreview();
    } catch (error) { fail(error); }
    event.target.value = '';
  };
  byId('bRemoveLogo').onclick = () => { draft.logo = ''; setDirty(); renderPreview(); };
  $$('#bSport [data-sport]').forEach(b => { b.onclick = () => { sport = b.dataset.sport; renderRoster(); }; });

  function addPlayers(list) {
    if (!list.length) { toast('No players found in that text.', 'error'); return; }
    for (const p of list) {
      const existing = p.num && players().find(x => x.num === p.num);
      const size = {...(p.ht ? {ht: p.ht} : {}), ...(p.wt ? {wt: p.wt} : {})}; // kept for spotting boards
      if (existing) Object.assign(existing, {name: p.name, pos: p.pos || existing.pos, cls: p.cls || existing.cls, ...size});
      else players().push({id: uid(), num: p.num || '', name: p.name.slice(0, 40), pos: (p.pos || '').slice(0, 6), cls: (p.cls || '').slice(0, 10), photo: '', ...size});
    }
    setDirty();
    renderRoster();
    toast(`${list.length} players added`);
  }
  byId('bAddPasted').onclick = () => { addPlayers(parseRoster(byId('bPaste').value)); byId('bPaste').value = ''; };
  byId('bImport').onchange = async event => {
    const file = event.target.files[0];
    try { addPlayers(parseRoster(/pdf$/i.test(file.name) || file.type === 'application/pdf' ? await pdfText(file) : await file.text())); } catch (error) { fail(error); }
    event.target.value = '';
  };
  byId('bAddOne').onclick = () => {
    players().push({id: uid(), num: '', name: '', pos: '', cls: '', photo: ''});
    setDirty();
    renderRoster();
    $('#bRoster .rosterRow:last-child [data-k=num]')?.focus();
  };
  byId('bClear').onclick = async () => {
    if (!players().length || !await confirmBox(`Clear the ${sport} roster?`, 'The players are removed when you save the team.', 'Clear')) return;
    draft.rosters[sport] = [];
    setDirty();
    renderRoster();
  };

  // ── Save, delete, use ──
  async function save() {
    const team = cleanTeam(draft);
    if (!draft.name.trim()) { toast('Give the team a name first.', 'error'); return null; }
    if (teams().some(t => t.id !== draft.id && sameName(t.name, team.name))) { toast(`There's already a team named ${team.name}.`, 'error'); return null; }
    const id = draft.id || uid();
    const oldName = savedName;
    const rosters = Object.fromEntries(SPORTS.map(s => [s, draft.rosters[s].filter(p => p.name.trim() || p.num.trim())
      .map(p => ({...p, name: p.name.trim().slice(0, 40) || 'Player', num: p.num.trim()}))]));
    const ok = await libraryDoc.commit(lib => {
      const existing = lib.teams.find(t => t.id === id);
      if (existing) Object.assign(existing, team); else lib.teams.push({id, ...team});
      lib.teams.sort((a, b) => a.name.localeCompare(b.name));
      lib.rosters = (lib.rosters || []).filter(r => !(sameName(r.name, team.name) || (oldName && sameName(r.name, oldName))));
      for (const s of SPORTS) if (rosters[s].length) lib.rosters.push({id: uid(), name: team.name, sport: s, players: rosters[s]});
    }).catch(error => { fail(error); return false; });
    if (!ok) return null;
    draft.id = id;
    draft.rosters = rosters;
    savedName = team.name;
    setDirty(false);
    byId('bDelete').hidden = false;
    renderPreview();
    renderRoster();
    renderList();
    toast(`${team.name} saved.${await updateGame(team, rosters, oldName)}`);
    return teams().find(t => t.id === id);
  }

  // If this team is in today's game, the scorebug and stat keeper pick up the change.
  async function updateGame(team, rosters, oldName) {
    const notes = [];
    for (const side of [0, 1]) {
      const onBug = liveDoc.doc?.teams[side];
      if (!onBug || !(sameName(onBug.name, team.name) || (oldName && sameName(onBug.name, oldName)))) continue;
      await change(d => { d.teams[side] = cleanTeam({...d.teams[side], ...team}); });
      const stats = statsDoc.doc;
      if (!stats) continue;
      if (stats.events.some(e => e.team === side)) notes.push(`The stat keeper roster wasn't changed because plays are logged for that side.`);
      else {
        await statsDoc.commit(s => { s.teams[side].players = copy(rosters[s.sport] || []); }).catch(fail);
        notes.push(`The scorebug and stat keeper are updated.`);
      }
    }
    return notes.length ? ' ' + notes.join(' ') : '';
  }

  byId('bForm').onsubmit = event => { event.preventDefault(); save(); };
  byId('bNew').onclick = async () => { if (await okToLeave()) open(blank()); };
  byId('bSearch').oninput = renderList;
  byId('bDelete').onclick = async () => {
    if (!draft?.id || !await confirmBox(`Delete ${savedName}?`, 'This removes the saved team and its rosters. A team already on the scorebug stays there.', 'Delete')) return;
    const id = draft.id;
    const name = savedName;
    const ok = await libraryDoc.commit(lib => {
      lib.teams = lib.teams.filter(t => t.id !== id);
      lib.rosters = (lib.rosters || []).filter(r => !sameName(r.name, name));
    }).catch(error => { fail(error); return false; });
    if (!ok) return;
    draft = null;
    setDirty(false);
    byId('bForm').hidden = true;
    byId('bEmpty').hidden = false;
    renderList();
    toast(`${name} deleted`);
  };
  $$('#bForm [data-use]').forEach(b => {
    b.onclick = async () => {
      const team = dirty || !draft.id ? await save() : teams().find(t => t.id === draft.id);
      if (team) loadProfile(Number(b.dataset.use), team);
    };
  });
  addEventListener('beforeunload', event => { if (dirty) event.preventDefault(); });

  return {
    show: () => renderList(),
    refresh: () => { if (!byId('tab-builder').hidden) renderList(); },
  };
}
