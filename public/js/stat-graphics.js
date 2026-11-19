// Ready-to-air stat graphics. Each function looks at the stat game as it is
// right now and returns a list of graphics with the numbers already filled in:
//   [{key, label, text, graphic}]
// `key` stays the same as the numbers change, so the control panel can keep a
// choice selected while stats come in and rebuild it at the moment of Take.
// Basketball only for now.
import {boxScore, compareRows, lineScore, points} from './stats-engine.js';

export const POSITIONS = {QB: 'Quarterback', RB: 'Running Back', WR: 'Wide Receiver', TE: 'Tight End', LB: 'Linebacker', DB: 'Defensive Back',
  DL: 'Defensive Line', OL: 'Offensive Line', K: 'Kicker', P: 'Punter', CB: 'Cornerback', S: 'Safety', DE: 'Defensive End', DT: 'Defensive Tackle',
  ATH: 'Athlete', G: 'Guard', F: 'Forward', C: 'Center', PG: 'Point Guard', SG: 'Shooting Guard', SF: 'Small Forward', PF: 'Power Forward'};
export const CLASSES = {FR: 'Freshman', SO: 'Sophomore', JR: 'Junior', SR: 'Senior', 9: 'Freshman', 10: 'Sophomore', 11: 'Junior', 12: 'Senior'};

const plural = (n, word, many = word + 's') => `${n} ${n === 1 ? word : many}`;
const pct = (made, att) => (att ? `${Math.round((made / att) * 100)}%` : '—');
const lastName = name => String(name || '').trim().split(/\s+/).at(-1) || '';
const cut = (text, max) => String(text).slice(0, max);

// The period plays are being logged in. HALF stamps as the 2nd quarter (the
// stat keeper does the same); FINAL means whatever period the last play was in.
export function statPeriod(period, events = []) {
  if (period === 'HALF') return '2nd';
  if (!period || period === 'FINAL') return events.at(-1)?.period || '4th';
  return period;
}

export function periodName(period) {
  if (period === 'OT') return 'Overtime';
  const ot = /^(\d)OT$/.exec(period);
  if (ot) return `${['', '1st', '2nd', '3rd', '4th'][ot[1]] || ot[1] + 'th'} Overtime`;
  return `${period} Quarter`;
}
const inPeriod = period => (period === 'OT' ? 'in overtime' : `in the ${periodName(period).toLowerCase()}`);

// Label above a whole-game graphic: "3rd Quarter", "Halftime", "Final".
export function gameKicker(period) {
  if (period === 'HALF') return 'Halftime';
  if (period === 'FINAL') return 'Final';
  return period ? periodName(period) : '';
}

// Points scored in a row by one team since the other team last scored.
export function currentRun(events) {
  let team = -1;
  let total = 0;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const p = points('basketball', events[i]);
    if (p <= 0) continue;
    if (team === -1) team = events[i].team;
    if (events[i].team !== team) break;
    total += p;
  }
  return team === -1 ? null : {team, points: total};
}

// The player-card fields every player graphic shares (photo, number, name…).
export function playerBase(player, team, teams) {
  const teamName = teams[team]?.name || '';
  const cls = CLASSES[String(player.cls || '').toUpperCase().replace('.', '')] || player.cls;
  return {
    type: 'player', side: team, title: cut(player.name, 90), number: player.num || '',
    kicker: POSITIONS[(player.pos || '').toUpperCase()] || player.pos || teamName,
    subtitle: [teamName, cls].filter(Boolean).join(' · '), rows: [],
  };
}

export function gameLine(l) {
  const parts = [`${l.pts} PTS`];
  if (l.fga) parts.push(`${l.fgm}-${l.fga} FG`);
  const reb = l.oreb + l.dreb;
  if (reb) parts.push(`${reb} REB`);
  if (l.ast) parts.push(`${l.ast} AST`);
  if (l.stl) parts.push(`${l.stl} STL`);
  if (l.blk) parts.push(`${l.blk} BLK`);
  return parts.slice(0, 5).join(' · ');
}

const blankLine = () => ({pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0});
const lineFor = (box, team, id) => box.teams[team].players.find(p => p.player.id === id)?.line || blankLine();

export function playerGraphics({stats, teams, team, playerId, period, photo = ''}) {
  const player = stats.teams[team]?.players.find(p => p.id === playerId);
  if (!player) return [];
  const l = lineFor(boxScore('basketball', stats), team, playerId);
  const now = statPeriod(period, stats.events);
  const q = lineFor(boxScore('basketball', {...stats, events: stats.events.filter(e => e.period === now)}), team, playerId);
  const base = playerBase(player, team, teams);
  const out = [];
  const add = (key, label, stat) => out.push({key, label, text: stat, graphic: {...base, photo, stat: cut(stat, 90)}});

  add('line', 'Game line', l.fga || l.fta || l.oreb + l.dreb || l.ast || l.stl || l.blk ? gameLine(l) : 'Tonight');
  if (l.pts) {
    const parts = [`${l.pts} PTS`];
    if (l.fga) parts.push(`${l.fgm}-${l.fga} FG`);
    if (l.tpa) parts.push(`${l.tpm}-${l.tpa} 3PT`);
    if (l.fta) parts.push(`${l.ftm}-${l.fta} FT`);
    add('points', 'Scoring', parts.join(' · '));
  }
  if (l.tpm) add('threes', '3-pointers', `${plural(l.tpm, 'three-pointer')} · ${l.tpm} of ${l.tpa}`);
  else if (l.tpa) add('threes', '3-pointers', `${l.tpm} of ${l.tpa} from three`);
  if (l.fta) add('ft', 'Free throws', `${l.ftm} of ${l.fta} at the line`);
  if (q.pts || q.fga || q.fta) {
    add('quarter', `This quarter (${now})`, [`${q.pts} PTS ${inPeriod(now)}`, ...(q.fga ? [`${q.fgm}-${q.fga} FG`] : [])].join(' · '));
  }
  const reb = l.oreb + l.dreb;
  if (reb) add('reb', 'Rebounds', [plural(reb, 'rebound'), ...(l.oreb ? [`${l.oreb} OFF`] : []), ...(l.dreb ? [`${l.dreb} DEF`] : [])].join(' · '));
  if (l.ast) add('ast', 'Assists', plural(l.ast, 'assist'));
  if (l.stl || l.blk) add('def', 'Defense', [l.stl && plural(l.stl, 'steal'), l.blk && plural(l.blk, 'block')].filter(Boolean).join(' · '));
  const tens = [['PTS', l.pts], ['REB', reb], ['AST', l.ast], ['STL', l.stl], ['BLK', l.blk]].filter(([, n]) => n >= 10);
  if (tens.length >= 2) add('double', tens.length >= 3 ? 'Triple-double' : 'Double-double', `${tens.length >= 3 ? 'Triple' : 'Double'}-double · ${tens.map(([k, n]) => `${n} ${k}`).join(' · ')}`);
  if (l.pf) add('fouls', 'Fouls', plural(l.pf, 'foul'));
  return out;
}

export function teamGraphics({stats, teams, period}) {
  const box = boxScore('basketball', stats);
  const out = [];
  const kicker = gameKicker(period);
  const short = i => teams[i]?.short || ['L', 'R'][i];
  const add = (key, label, text, graphic) => out.push({key, label, text, graphic: {side: -1, kicker: '', subtitle: '', ...graphic}});

  if (!stats.events.length) return out;
  const [a, b] = box.teams.map(t => t.line);
  add('compare', 'Team stats', `${short(0)} ${pct(a.fgm, a.fga)} FG · ${short(1)} ${pct(b.fgm, b.fga)} FG`,
    {type: 'compare', title: 'Team Stats', kicker, rows: compareRows('basketball', box)});

  const now = statPeriod(period, stats.events);
  const quarterEvents = stats.events.filter(e => e.period === now);
  if (quarterEvents.length) {
    const qBox = boxScore('basketball', {...stats, events: quarterEvents});
    const [qa, qb] = qBox.teams.map(t => t.line);
    add('quarter', `This quarter (${now})`, `${short(0)} ${qa.pts} · ${short(1)} ${qb.pts}`,
      {type: 'compare', title: periodName(now), kicker: 'Team Stats', rows: [
        {label: 'Points', left: String(qa.pts), right: String(qb.pts)},
        ...compareRows('basketball', qBox).filter(r => r.label !== 'FG %'),
      ].slice(0, 6)});
  }

  add('shooting', 'Shooting', `${short(0)} ${a.tpm}-${a.tpa} 3PT · ${short(1)} ${b.tpm}-${b.tpa} 3PT`, {type: 'compare', title: 'Shooting', kicker, rows: [
    {label: 'Field Goals', left: `${a.fgm}-${a.fga}`, right: `${b.fgm}-${b.fga}`},
    {label: 'FG %', left: pct(a.fgm, a.fga), right: pct(b.fgm, b.fga)},
    {label: '3-Pointers', left: `${a.tpm}-${a.tpa}`, right: `${b.tpm}-${b.tpa}`},
    {label: '3PT %', left: pct(a.tpm, a.tpa), right: pct(b.tpm, b.tpa)},
    {label: 'Free Throws', left: `${a.ftm}-${a.fta}`, right: `${b.ftm}-${b.fta}`},
    {label: 'FT %', left: pct(a.ftm, a.fta), right: pct(b.ftm, b.fta)},
  ]});

  // Game leaders: "14 Comet | Points | 12 Blaze". Number first so the overlay
  // can highlight the higher side.
  const leader = (team, value) => {
    let best = null;
    for (const p of box.teams[team].players) {
      const v = value(p.line);
      if (v > 0 && (!best || v > best.v)) best = {v, name: lastName(p.player.name)};
    }
    return best ? cut(`${best.v} ${best.name}`, 30) : '—';
  };
  const categories = [['Points', l => l.pts], ['Rebounds', l => l.oreb + l.dreb], ['Assists', l => l.ast], ['Steals', l => l.stl], ['Blocks', l => l.blk]];
  const leaderRows = categories
    .map(([label, value]) => ({label, left: leader(0, value), right: leader(1, value)}))
    .filter(r => r.left !== '—' || r.right !== '—');
  if (leaderRows.length) {
    add('leaders', 'Game leaders', `Points: ${leaderRows[0].left} · ${leaderRows[0].right}`, {type: 'compare', title: 'Game Leaders', kicker, rows: leaderRows});
  }

  const lines = lineScore('basketball', stats.events);
  const played = lines.columns.filter((c, i) => lines.rows[0][i] || lines.rows[1][i] || stats.events.some(e => (/OT/.test(e.period) ? 'OT' : e.period) === c));
  if (played.length) {
    const rows = played.map(c => {
      const i = lines.columns.indexOf(c);
      return {label: c === 'OT' ? 'Overtime' : `${c} Quarter`, left: String(lines.rows[0][i]), right: String(lines.rows[1][i])};
    });
    rows.push({label: 'Total', left: String(box.totals[0]), right: String(box.totals[1])});
    add('byQuarter', 'Scoring by quarter', rows.slice(0, -1).map(r => `${r.left}-${r.right}`).join(', '),
      {type: 'compare', title: 'Scoring by Quarter', kicker, rows: rows.slice(-6)});
  }

  [0, 1].forEach(team => {
    const scorers = box.teams[team].players.filter(p => p.line.pts > 0).sort((x, y) => y.line.pts - x.line.pts).slice(0, 3);
    if (!scorers.length) return;
    add('scorers' + team, `${teams[team]?.name || short(team)} leading scorers`, scorers.map(p => `${lastName(p.player.name)} ${p.line.pts}`).join(', '), {
      type: 'message', side: team, title: 'Leading Scorers', kicker: teams[team]?.name || '',
      rows: scorers.map(p => ({label: cut(`${p.player.num ? '#' + p.player.num + ' ' : ''}${p.player.name}`, 40), left: `${p.line.pts} PTS`})),
    });
  });

  const run = currentRun(stats.events);
  if (run && run.points >= 4) {
    add('run', 'Current run', `${teams[run.team]?.name || short(run.team)} ${run.points}-0`, {
      type: 'message', side: run.team, title: `${run.points}-0 Run`, kicker: teams[run.team]?.name || '', subtitle: `${run.points} unanswered points`,
    });
  }
  return out;
}
