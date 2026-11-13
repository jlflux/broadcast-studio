// Pure stat math. A stat game is a list of events; every total (score, box
// score, line score, stat lines for graphics) is derived from that list, so
// deleting or editing a play recalculates everything.
//
// Every event: {id, type, team (0|1, the side credited), player (id|null), period, clock (ms|null)}
// Football:
//   pass  {result:'complete'|'incomplete'|'int', receiver, yards, td, defender}
//   rush  {yards, td}                    sack {yards (loss, positive), defender}
//   fumble {lost, recoveredBy}           tackle {}   (player = tackler)
//   ret   {kind:'punt'|'kick'|'int'|'fumble', yards, td}
//   fg {yards, good}  pat {kind:'kick'|'run'|'pass', good}  punt {yards}
//   safety {} (team = scoring team)      adj {points, note}
// Basketball:
//   fg {three, made, ast}  ft {made}  reb {off}  stl  blk  to  pf  adj {points, note}

export const PERIODS = {
  football: ['1st', '2nd', '3rd', '4th', 'OT'],
  basketball: ['1st', '2nd', '3rd', '4th', 'OT'],
};

export function points(sport, event) {
  if (event.type === 'adj') return Number(event.points) || 0;
  if (sport === 'basketball') {
    if (event.type === 'fg') return event.made ? (event.three ? 3 : 2) : 0;
    if (event.type === 'ft') return event.made ? 1 : 0;
    return 0;
  }
  switch (event.type) {
    case 'pass': return event.result === 'complete' && event.td ? 6 : 0;
    case 'rush': case 'ret': return event.td ? 6 : 0;
    case 'fg': return event.good ? 3 : 0;
    case 'pat': return event.good ? (event.kind === 'kick' ? 1 : 2) : 0;
    case 'safety': return 2;
    default: return 0;
  }
}

// Which side the points go to. Interception-return and fumble-return TDs are
// logged as `ret` events by the defense, so the team field is always right.
export function score(sport, events) {
  const total = [0, 0];
  for (const event of events) total[event.team] += points(sport, event);
  return total;
}

const periodKey = period => (/OT/i.test(period) ? 'OT' : period);

export function lineScore(sport, events) {
  const columns = [...PERIODS[sport]];
  const rows = [Object.fromEntries(columns.map(c => [c, 0])), Object.fromEntries(columns.map(c => [c, 0]))];
  for (const event of events) {
    const p = points(sport, event);
    if (!p) continue;
    const key = periodKey(event.period || '1st');
    const column = columns.includes(key) ? key : columns[0];
    rows[event.team][column] += p;
  }
  const hasOT = rows.some(row => row.OT);
  const shown = hasOT ? columns : columns.filter(c => c !== 'OT');
  return {columns: shown, rows: rows.map(row => shown.map(c => row[c]))};
}

export function teamFouls(events, period) {
  const fouls = [0, 0];
  const key = periodKey(period);
  for (const event of events) if (event.type === 'pf' && periodKey(event.period) === key) fouls[event.team] += 1;
  return fouls;
}

const blankFootball = () => ({
  pass: {cmp: 0, att: 0, yds: 0, td: 0, int: 0, long: 0},
  rush: {car: 0, yds: 0, td: 0, long: 0},
  rec: {rec: 0, yds: 0, td: 0, long: 0},
  def: {tkl: 0, sack: 0, int: 0, fr: 0},
  kick: {fgm: 0, fga: 0, long: 0, xpm: 0, xpa: 0},
  punt: {no: 0, yds: 0, long: 0},
  ret: {no: 0, yds: 0, td: 0},
  two: 0, fum: 0, fumLost: 0,
});
const blankBasketball = () => ({pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0});

export function boxScore(sport, game) {
  const blank = sport === 'football' ? blankFootball : blankBasketball;
  const players = game.teams.map(team => new Map(team.players.map(p => [p.id, {player: p, line: blank()}])));
  const teamLine = [blank(), blank()];
  const line = (team, id) => {
    if (id && players[team].has(id)) return players[team].get(id).line;
    // A player removed from the roster, or a team stat with no player.
    if (id) {
      const ghost = {player: {id, num: '', name: 'Unknown player'}, line: blank()};
      players[team].set(id, ghost);
      return ghost.line;
    }
    return null;
  };
  const both = (team, id, apply) => {
    apply(teamLine[team]);
    const target = line(team, id);
    if (target) apply(target);
  };
  const other = team => 1 - team;

  for (const e of game.events) {
    const yards = Number(e.yards) || 0;
    if (sport === 'basketball') {
      switch (e.type) {
        case 'fg': both(e.team, e.player, l => {
          l.fga += 1; if (e.three) l.tpa += 1;
          if (e.made) { l.fgm += 1; l.pts += e.three ? 3 : 2; if (e.three) l.tpm += 1; }
        });
          if (e.made && e.ast) both(e.team, e.ast, l => { l.ast += 1; });
          break;
        case 'ft': both(e.team, e.player, l => { l.fta += 1; if (e.made) { l.ftm += 1; l.pts += 1; } }); break;
        case 'reb': both(e.team, e.player, l => { if (e.off) l.oreb += 1; else l.dreb += 1; }); break;
        case 'stl': case 'blk': case 'to': case 'pf': both(e.team, e.player, l => { l[e.type] += 1; }); break;
        case 'adj': both(e.team, null, l => { l.pts += Number(e.points) || 0; }); break;
      }
      continue;
    }
    switch (e.type) {
      case 'pass':
        both(e.team, e.player, l => {
          l.pass.att += 1;
          if (e.result === 'complete') { l.pass.cmp += 1; l.pass.yds += yards; l.pass.long = Math.max(l.pass.long, yards); if (e.td) l.pass.td += 1; }
          if (e.result === 'int') l.pass.int += 1;
        });
        if (e.result === 'complete' && e.receiver) {
          const r = line(e.team, e.receiver);
          r.rec.rec += 1; r.rec.yds += yards; r.rec.long = Math.max(r.rec.long, yards); if (e.td) r.rec.td += 1;
        }
        if (e.result === 'complete') { teamLine[e.team].rec.rec += 1; teamLine[e.team].rec.yds += yards; }
        if (e.result === 'int') both(other(e.team), e.defender, l => { l.def.int += 1; });
        break;
      case 'rush':
        both(e.team, e.player, l => { l.rush.car += 1; l.rush.yds += yards; l.rush.long = Math.max(l.rush.long, yards); if (e.td) l.rush.td += 1; });
        break;
      case 'sack':
        // NFHS/NCAA convention: a sack is a rush by the passer for lost yards.
        both(e.team, e.player, l => { l.rush.car += 1; l.rush.yds -= Math.abs(yards); });
        if (e.defender) both(other(e.team), e.defender, l => { l.def.sack += 1; l.def.tkl += 1; });
        else teamLine[other(e.team)].def.sack += 1;
        break;
      case 'fumble':
        both(e.team, e.player, l => { l.fum += 1; if (e.lost) l.fumLost += 1; });
        if (e.lost && e.recoveredBy) both(other(e.team), e.recoveredBy, l => { l.def.fr += 1; });
        break;
      case 'tackle': both(e.team, e.player, l => { l.def.tkl += 1; }); break;
      case 'ret': both(e.team, e.player, l => { l.ret.no += 1; l.ret.yds += yards; if (e.td) l.ret.td += 1; }); break;
      case 'fg': both(e.team, e.player, l => { l.kick.fga += 1; if (e.good) { l.kick.fgm += 1; l.kick.long = Math.max(l.kick.long, yards); } }); break;
      case 'pat':
        if (e.kind === 'kick') both(e.team, e.player, l => { l.kick.xpa += 1; if (e.good) l.kick.xpm += 1; });
        else if (e.good) both(e.team, e.player, l => { l.two += 1; });
        break;
      case 'punt': both(e.team, e.player, l => { l.punt.no += 1; l.punt.yds += yards; l.punt.long = Math.max(l.punt.long, yards); }); break;
    }
  }
  const totals = score(sport, game.events);
  return {
    sport,
    totals,
    teams: [0, 1].map(team => ({
      line: teamLine[team],
      players: [...players[team].values()].sort((a, b) => (parseInt(a.player.num, 10) || 999) - (parseInt(b.player.num, 10) || 999)),
    })),
  };
}

const pct = (made, att) => att ? `${Math.round((made / att) * 100)}%` : '—';

export function statLine(sport, l) {
  if (!l) return '';
  if (sport === 'basketball') {
    const parts = [`${l.pts} PTS`];
    if (l.fga) parts.push(`${l.fgm}-${l.fga} FG`);
    if (l.tpa) parts.push(`${l.tpm}-${l.tpa} 3PT`);
    if (l.oreb + l.dreb) parts.push(`${l.oreb + l.dreb} REB`);
    if (l.ast) parts.push(`${l.ast} AST`);
    if (l.stl) parts.push(`${l.stl} STL`);
    if (l.blk) parts.push(`${l.blk} BLK`);
    return parts.slice(0, 5).join(' · ');
  }
  const groups = [];
  if (l.pass.att) groups.push([`${l.pass.cmp}/${l.pass.att}`, `${l.pass.yds} YDS`, `${l.pass.td} TD`, ...(l.pass.int ? [`${l.pass.int} INT`] : [])].join(' · '));
  if (l.rush.car) groups.push([`${l.rush.car} CAR`, `${l.rush.yds} YDS`, ...(l.rush.td ? [`${l.rush.td} TD`] : [])].join(' · '));
  if (l.rec.rec) groups.push([`${l.rec.rec} REC`, `${l.rec.yds} YDS`, ...(l.rec.td ? [`${l.rec.td} TD`] : [])].join(' · '));
  if (l.def.tkl || l.def.sack || l.def.int || l.def.fr) {
    groups.push([l.def.tkl && `${l.def.tkl} TKL`, l.def.sack && `${l.def.sack} SACK`, l.def.int && `${l.def.int} INT`, l.def.fr && `${l.def.fr} FR`].filter(Boolean).join(' · '));
  }
  if (l.kick.fga || l.kick.xpa) groups.push([l.kick.fga && `FG ${l.kick.fgm}/${l.kick.fga}`, l.kick.xpa && `XP ${l.kick.xpm}/${l.kick.xpa}`].filter(Boolean).join(' · '));
  if (l.ret.no) groups.push([`${l.ret.no} RET`, `${l.ret.yds} YDS`, ...(l.ret.td ? [`${l.ret.td} TD`] : [])].join(' · '));
  if (l.punt.no) groups.push(`${l.punt.no} PUNTS · ${(l.punt.yds / l.punt.no).toFixed(1)} AVG`);
  return groups.slice(0, 2).join('  |  ');
}

export function compareRows(sport, box) {
  const [a, b] = box.teams.map(t => t.line);
  if (sport === 'basketball') {
    return [
      {label: 'Field Goals', left: `${a.fgm}-${a.fga}`, right: `${b.fgm}-${b.fga}`},
      {label: 'FG %', left: pct(a.fgm, a.fga), right: pct(b.fgm, b.fga)},
      {label: '3-Pointers', left: `${a.tpm}-${a.tpa}`, right: `${b.tpm}-${b.tpa}`},
      {label: 'Free Throws', left: `${a.ftm}-${a.fta}`, right: `${b.ftm}-${b.fta}`},
      {label: 'Rebounds', left: String(a.oreb + a.dreb), right: String(b.oreb + b.dreb)},
      {label: 'Turnovers', left: String(a.to), right: String(b.to)},
    ];
  }
  const turnovers = line => line.pass.int + line.fumLost;
  return [
    {label: 'Total Yards', left: String(a.pass.yds + a.rush.yds), right: String(b.pass.yds + b.rush.yds)},
    {label: 'Rushing', left: String(a.rush.yds), right: String(b.rush.yds)},
    {label: 'Passing', left: String(a.pass.yds), right: String(b.pass.yds)},
    {label: 'Comp-Att', left: `${a.pass.cmp}-${a.pass.att}`, right: `${b.pass.cmp}-${b.pass.att}`},
    {label: 'Turnovers', left: String(turnovers(a)), right: String(turnovers(b))},
  ];
}

// Human-readable play-by-play text.
export function describe(sport, event, game) {
  const roster = team => game.teams[team]?.players || [];
  const who = (team, id) => {
    if (!id) return game.teams[team]?.short || 'Team';
    const p = roster(team).find(x => x.id === id);
    return p ? `#${p.num} ${p.name}`.trim() : 'Unknown player';
  };
  const me = who(event.team, event.player);
  const yd = n => `${n} yd${Math.abs(n) === 1 ? '' : 's'}`;
  if (event.type === 'adj') return `${game.teams[event.team]?.short || 'Team'} score ${event.points > 0 ? '+' : ''}${event.points}${event.note ? ` (${event.note})` : ''}`;
  if (sport === 'basketball') {
    switch (event.type) {
      case 'fg': return `${me} ${event.made ? 'makes' : 'misses'} ${event.three ? '3-pointer' : 'jumper'}${event.made && event.ast ? ` (ast ${who(event.team, event.ast)})` : ''}`;
      case 'ft': return `${me} ${event.made ? 'makes' : 'misses'} free throw`;
      case 'reb': return `${me} ${event.off ? 'offensive' : 'defensive'} rebound`;
      case 'stl': return `${me} steal`;
      case 'blk': return `${me} block`;
      case 'to': return `${me} turnover`;
      case 'pf': return `Foul on ${me}`;
    }
  }
  switch (event.type) {
    case 'pass':
      if (event.result === 'complete') return `${me} pass complete to ${who(event.team, event.receiver)} for ${yd(event.yards)}${event.td ? ', TOUCHDOWN' : ''}`;
      if (event.result === 'int') return `${me} pass INTERCEPTED${event.defender ? ` by ${who(1 - event.team, event.defender)}` : ''}`;
      return `${me} pass incomplete${event.receiver ? ` to ${who(event.team, event.receiver)}` : ''}`;
    case 'rush': return `${me} rush for ${yd(event.yards)}${event.td ? ', TOUCHDOWN' : ''}`;
    case 'sack': return `${me} sacked for −${Math.abs(event.yards)}${event.defender ? ` by ${who(1 - event.team, event.defender)}` : ''}`;
    case 'fumble': return `${me} fumble${event.lost ? `, lost${event.recoveredBy ? ` (rec. ${who(1 - event.team, event.recoveredBy)})` : ''}` : ', recovered'}`;
    case 'tackle': return `Tackle by ${me}`;
    case 'ret': return `${me} ${event.kind} return for ${yd(event.yards)}${event.td ? ', TOUCHDOWN' : ''}`;
    case 'fg': return `${me} ${event.yards} yd field goal ${event.good ? 'GOOD' : 'no good'}`;
    case 'pat': return `${me} ${event.kind === 'kick' ? 'extra point' : `2-pt ${event.kind}`} ${event.good ? 'good' : 'no good'}`;
    case 'punt': return `${me} punt for ${yd(event.yards)}`;
    case 'safety': return `SAFETY, ${game.teams[event.team]?.short || 'team'} +2`;
  }
  return event.type;
}

// "12 John Smith QB 11", "John Smith, 12, WR", CSV with a header, etc.
export function parseRoster(text) {
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const players = [];
  const header = lines[0].toLowerCase();
  const csv = /,|\t/.test(lines[0]) && /(name|#|no\b|num|number|jersey)/.test(header);
  if (csv) {
    const split = l => l.split(/\t|,/).map(c => c.trim().replace(/^"|"$/g, ''));
    const cols = split(header);
    const find = (...names) => cols.findIndex(c => names.some(n => c === n || c.includes(n)));
    const num = find('#', 'no', 'num', 'jersey'), name = find('name', 'player'), first = find('first'), last = find('last');
    const pos = find('pos'), cls = find('yr', 'year', 'class', 'grade', 'cl');
    for (const row of lines.slice(1).map(split)) {
      const full = name >= 0 && first < 0 ? row[name] : [row[first], row[last]].filter(Boolean).join(' ');
      if (!full) continue;
      players.push({num: (row[num] || '').replace(/\D/g, ''), name: full, pos: pos >= 0 ? row[pos] || '' : '', cls: cls >= 0 ? row[cls] || '' : ''});
    }
    return players;
  }
  const POS = /^(QB|RB|HB|FB|WR|TE|OL|OT|OG|C|DL|DT|DE|LB|ILB|OLB|DB|CB|S|FS|SS|K|P|LS|KR|PR|ATH|G|F|PG|SG|SF|PF|G\/F|F\/C|[A-Z]{1,3}\/[A-Z]{1,3})$/i;
  const CLS = /^(FR|SO|JR|SR|Fr\.?|So\.?|Jr\.?|Sr\.?|7|8|9|10|11|12|7th|8th|9th|10th|11th|12th|Freshman|Sophomore|Junior|Senior)$/i;
  for (const raw of lines) {
    let tokens = raw.replace(/[•·|]/g, ' ').split(/[\s,]+/).filter(Boolean);
    let num = '';
    // A token with "#" wins; otherwise the first 1–2 digit number is the jersey.
    let numAt = tokens.findIndex(t => /^#\d{1,2}$/.test(t));
    if (numAt < 0) numAt = tokens.findIndex(t => /^\d{1,2}$/.test(t));
    if (numAt >= 0) {
      num = tokens[numAt].replace('#', '');
      tokens.splice(numAt, 1);
    }
    let pos = '', cls = '';
    tokens = tokens.filter(t => {
      if (!pos && POS.test(t) && t.length <= 5 && t === t.toUpperCase()) { pos = t.toUpperCase(); return false; }
      if (!cls && CLS.test(t) && (/^\d+(th)?$/.test(t) ? tokens.length > 2 : true)) { cls = t.replace('.', ''); return false; }
      if (/^\d-\d{1,2}$|^\d{3}$|lbs?\.?$/i.test(t)) return false; // height / weight
      return true;
    });
    const name = tokens.join(' ').replace(/\s+/g, ' ').trim();
    if (!name || /^(no|name|pos|player|roster)$/i.test(name)) continue;
    players.push({num, name, pos, cls});
  }
  return players;
}
