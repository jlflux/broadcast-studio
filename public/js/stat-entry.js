// Tap-a-player-then-an-action stat entry, shared by the stat keeper page and
// the control panel's Live tab. Logs plays to the stats doc, time-stamps them
// from the scorebug clock, and sends the score (and basketball team fouls)
// to the scorebug.
import {$, $$, byId, esc, remaining, serverNow, setText, toast, uid} from './common.js';
import {describe, points, score, teamFouls} from './stats-engine.js';

const DIALOG = `<dialog id="playDialog"><form method="dialog" id="playForm"><h2 id="playTitle"></h2><div id="playFields" class="stack"></div><div class="row"><button value="cancel" formnovalidate>Cancel</button><button value="ok" class="primary" id="playSave">Save play</button></div></form></dialog>`;
function playDialog() {
  if (!byId('playDialog')) document.body.insertAdjacentHTML('beforeend', DIALOG);
  return byId('playDialog');
}

// els: {side0, side1, selected, actions, recent} elements.
// headers: show each team's name and stat score above its players.
// keys: U / Ctrl+Z undo and Esc to deselect (off where other shortcuts live).
export function createStatEntry({statsDoc, liveDoc, els, fallbackPeriod = () => '1st', headers = true, keys = true, rosterHint = 'Add players in the Rosters tab.', afterChange = () => {}, fail}) {
  const S = () => statsDoc.doc;
  const L = () => liveDoc.doc;
  const other = team => 1 - team;
  let selected = null; // {team, id}
  let sending = false;

  const linked = () => liveDoc.ready && statsDoc.ready && L().sport === S().sport;
  function stamp() {
    if (linked()) {
      const g = L().games[S().sport];
      return {period: g.period === 'HALF' ? '2nd' : g.period, clock: remaining(g.game, serverNow())};
    }
    return {period: fallbackPeriod(), clock: null};
  }
  const teamName = i => (liveDoc.ready ? L().teams[i].name : ['Left', 'Right'][i]);
  const teamShort = i => (liveDoc.ready ? L().teams[i].short : ['L', 'R'][i]);

  // afterUndo: undoing the last play still syncs (back to 0–0), even with no plays left.
  async function sendToBug(force = false, afterUndo = false) {
    if (!linked() || (!force && S().autoSend === false) || (!S().events.length && !afterUndo)) return;
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
    finally { sending = false; afterChange(); }
  }

  async function addEvents(...events) {
    const time = stamp();
    const stamped = events.map(e => ({id: uid(), ...time, at: Date.now(), ...e}));
    try {
      await statsDoc.commit(s => { s.events.push(...stamped); if (!s.startedAt) s.startedAt = Date.now(); });
      const pts = stamped.reduce((n, e) => n + points(S().sport, e), 0);
      toast(describe(S().sport, stamped[0], S()) + (pts ? `  (+${pts})` : ''));
      selected = null;
      render();
      afterChange();
      sendToBug();
    } catch (error) { fail(error); }
  }

  // Dialog with fields; resolves to the values or null.
    function ask(title, fields, {autoSubmit = false} = {}) {
    const dialog = playDialog();
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


  function render() {
    if (!statsDoc.ready) return;
    const sport = S().sport;
    [0, 1].forEach(team => {
      const side = els['side' + team];
      if (liveDoc.ready) side.style.setProperty('--team', L().teams[team].color);
      const players = S().teams[team].players;
      side.innerHTML = `${headers ? `<h2><span>${esc(teamName(team))}</span><span class="readout" style="font-size:30px">${score(sport, S().events)[team]}</span></h2>` : ''}
        <div class="players">${players.length ? players.map(p => `<button type="button" class="player ${selected?.id === p.id ? 'sel' : ''}" data-id="${esc(p.id)}"><b>${esc(p.num)}</b><span>${esc(p.name)}<small>${esc(p.pos || '')}</small></span></button>`).join('') : `<p class="muted">No roster yet. ${esc(rosterHint)}</p>`}</div>
        <div class="teamActs">${teamActions[sport].map(([label], i) => `<button type="button" data-team-act="${i}">${esc(label)}</button>`).join('')}</div>`;
      $$('.player', side).forEach(b => {
        b.onclick = () => { selected = selected?.id === b.dataset.id ? null : {team, id: b.dataset.id}; render(); };
      });
      $$('[data-team-act]', side).forEach(b => { b.onclick = () => teamActions[sport][Number(b.dataset.teamAct)][1](team); });
    });
    const pick = selected && S().teams[selected.team].players.find(p => p.id === selected.id);
    if (selected && !pick) selected = null;
    const label = els.selected;
    label.classList.toggle('on', Boolean(pick));
    label.textContent = pick ? `${teamShort(selected.team)} · #${pick.num} ${pick.name}` : 'Tap a player, then an action';
    const groups = sport === 'football' ? FOOTBALL : BASKETBALL;
    els.actions.innerHTML = groups.map(([group, actions], g) => `<div class="groupLabel">${esc(group)}</div>${actions.map(([name, cls], a) => `<button type="button" class="${cls}" data-g="${g}" data-a="${a}" ${pick ? '' : 'disabled'}>${esc(name)}</button>`).join('')}`).join('');
    $$('[data-a]', els.actions).forEach(b => { b.onclick = () => { if (need()) groups[Number(b.dataset.g)][1][Number(b.dataset.a)][2](); }; });
    const recent = S().events.slice(-5).reverse();
    els.recent.innerHTML = recent.length ? '<span class="label">Last plays</span>' + recent.map(e => `<div><span>${esc(e.period || '')}</span><b>${esc(describe(sport, e, S()))}</b></div>`).join('') : '';
  }

  async function undo() {
    const last = S().events.at(-1);
    if (!last) return;
    try {
      await statsDoc.commit(s => { if (s.events.at(-1)?.id !== last.id) return false; s.events.pop(); });
      toast('Undid: ' + describe(S().sport, last, S()));
      render();
      afterChange();
      sendToBug(false, true);
    } catch (error) { fail(error); }
  }

  if (keys) {
    addEventListener('keydown', event => {
      if (event.target.closest('input, textarea, select, dialog')) return;
      if ((event.key === 'z' && (event.metaKey || event.ctrlKey)) || event.key === 'u') { event.preventDefault(); undo(); }
      if (event.key === 'Escape') { selected = null; render(); }
    });
  }

  return {render, undo, sendToBug, linked, get sending() { return sending; }};
}
