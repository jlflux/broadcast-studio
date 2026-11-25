// Full-screen graphics: matchup, starting lineup, keys to the game, score &
// team stats, and game leaders. Each builder returns the on-air object with
// every number already filled in, so it stays the same while it's up (take it
// again to update it). Team names, colors and logos come from the scorebug.
import {boxScore, compareRows, lineScore} from './stats-engine.js';
import {CLASSES, gameKicker} from './stat-graphics.js';

export const FULL_KINDS = [['matchup', 'Matchup'], ['lineup', 'Lineup'], ['keys', 'Keys to the game'], ['stats', 'Score & stats'], ['leaders', 'Leaders']];
export const LINEUP_MAX = {basketball: 5, football: 12};
const cut = (text, max) => String(text ?? '').trim().slice(0, max);

export function defaultFullDrafts() {
  return {
    matchup: {kicker: 'Tonight', title: '', subtitle: '', clock: 'off', startTime: '', clockLabel: ''},
    lineup: {side: 0, kicker: '', title: 'Starting Lineup', subtitle: '', picks: {}},
    keys: {side: -1, kicker: '', title: 'Keys to the Game', subtitle: '', points: ['', '', '', '']},
    stats: {kicker: '', title: 'Team Stats', subtitle: '', showLine: true},
    leaders: {kicker: '', title: 'Game Leaders', subtitle: ''},
  };
}

// The label on top of stat screens when it's left blank: "Halftime", "Final", "3rd Quarter".
export const autoKicker = period => gameKicker(period) || '';

function base(kind, draft, extra = {}) {
  return {kind, side: [0, 1].includes(draft.side) ? draft.side : -1, kicker: cut(draft.kicker, 60), title: cut(draft.title, 90), subtitle: cut(draft.subtitle, 140), ...extra};
}

export const CLOCK_LABEL = {basketball: 'Tip-off in', football: 'Kickoff in'};

// "19:00" today in this browser's time zone. A time more than an hour gone is
// taken to mean tomorrow (setting up after midnight for an early game).
export function startAtFor(time, now = Date.now()) {
  const match = String(time || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 0;
  const at = new Date(now);
  at.setHours(Number(match[1]), Number(match[2]), 0, 0);
  if (at.getTime() < now - 3600000) at.setDate(at.getDate() + 1);
  return at.getTime();
}

// The matchup can carry a clock: a countdown to the start time, or the
// scorebug's game clock (for a pregame countdown run on the scoreboard).
// Either one runs live on air; nothing about it is locked at Take.
export function matchupFull(draft, sport = 'basketball', now = Date.now()) {
  const extra = {};
  if (draft.clock === 'start' || draft.clock === 'game') {
    const startAt = draft.clock === 'start' ? startAtFor(draft.startTime, now) : 0;
    if (draft.clock === 'game' || startAt) {
      extra.clock = draft.clock;
      if (startAt) extra.startAt = startAt;
      extra.clockLabel = cut(draft.clockLabel, 30) || CLOCK_LABEL[sport] || 'Starts in';
    }
  }
  return base('matchup', {...draft, side: -1}, extra);
}

export function keysFull(draft) {
  const points = (draft.points || []).map(p => cut(p, 140)).filter(Boolean).slice(0, 5);
  return base('keys', draft, {points});
}

// players: roster entries in the order picked, with `photo` already resolved
// to image data (or '').
export function lineupFull(draft, players, sport) {
  const max = LINEUP_MAX[sport] || 5;
  const list = players.slice(0, max).map(p => ({
    num: cut(p.num, 4), name: cut(p.name, 60), pos: cut(p.pos, 12),
    cls: cut(CLASSES[String(p.cls || '').toUpperCase().replace('.', '')] || p.cls, 12),
    // Photo cards are used up to five players; longer lists are text rows.
    photo: players.length <= 5 ? (p.photo || '') : '', photoPos: p.photo && players.length <= 5 ? (p.photoPos || '') : '',
  }));
  return base('lineup', {...draft, side: draft.side === 1 ? 1 : 0}, {players: list});
}

function extraRows(sport, box) {
  const [a, b] = box.teams.map(t => t.line);
  if (sport !== 'basketball') {
    return [{label: 'Yards / Play', left: perPlay(a), right: perPlay(b)}];
  }
  return [
    {label: 'Assists', left: String(a.ast), right: String(b.ast)},
    {label: 'Steals', left: String(a.stl), right: String(b.stl)},
    {label: 'Blocks', left: String(a.blk), right: String(b.blk)},
  ];
}
function perPlay(line) {
  const plays = line.pass.att + line.rush.car;
  return plays ? ((line.pass.yds + line.rush.yds) / plays).toFixed(1) : '—';
}

// Score from the scorebug (what viewers have been seeing), team stats and the
// line score from the stat keeper. The line score only shows when its totals
// match the scorebug, so the screen never shows two different scores.
export function statsFull(draft, {live, stats}) {
  const sport = live.sport;
  const game = live.games[sport];
  const extra = {score: [...game.score], period: cut(game.period, 8)};
  const kicker = cut(draft.kicker, 60) || autoKicker(game.period);
  const hasStats = stats && stats.sport === sport && stats.events.length > 0;
  if (hasStats) {
    const box = boxScore(sport, stats);
    const line = lineScore(sport, stats.events);
    const totals = line.rows.map(row => row.reduce((sum, n) => sum + n, 0));
    if (draft.showLine !== false && totals[0] === game.score[0] && totals[1] === game.score[1]) {
      extra.line = {columns: line.columns.slice(0, 8), rows: line.rows.map(row => row.slice(0, 8))};
    }
    // With a line score there's room for seven stat rows; without, nine.
    extra.rows = [...compareRows(sport, box), ...extraRows(sport, box)].slice(0, extra.line ? 7 : 9);
  } else extra.rows = [];
  return base('stats', {...draft, kicker, side: -1}, extra);
}

const CATEGORIES = {
  basketball: [
    ['Points', l => l.pts, l => (l.fga ? `${l.fgm}-${l.fga} FG` : '') + (l.tpm ? ` · ${l.tpm} 3PT` : '')],
    ['Rebounds', l => l.oreb + l.dreb, l => (l.oreb ? `${l.oreb} OFF` : '')],
    ['Assists', l => l.ast, () => ''],
    ['Steals', l => l.stl, l => (l.blk ? `${l.blk} BLK` : '')],
  ],
  football: [
    ['Passing', l => l.pass.yds, l => (l.pass.att ? `${l.pass.cmp}/${l.pass.att} · ${l.pass.td} TD${l.pass.int ? ` · ${l.pass.int} INT` : ''}` : ''), l => l.pass.att],
    ['Rushing', l => l.rush.yds, l => (l.rush.car ? `${l.rush.car} CAR${l.rush.td ? ` · ${l.rush.td} TD` : ''}` : ''), l => l.rush.car],
    ['Receiving', l => l.rec.yds, l => (l.rec.rec ? `${l.rec.rec} REC${l.rec.td ? ` · ${l.rec.td} TD` : ''}` : ''), l => l.rec.rec],
    ['Tackles', l => l.def.tkl, l => [l.def.sack && `${l.def.sack} SACK`, l.def.int && `${l.def.int} INT`].filter(Boolean).join(' · ')],
  ],
};
const UNITS = {Points: '', Rebounds: '', Assists: '', Steals: '', Passing: 'YDS', Rushing: 'YDS', Receiving: 'YDS', Tackles: ''};

// Leader in each category for each team. Nobody with a stat in it: null.
export function leaders(sport, stats) {
  const box = boxScore(sport, stats);
  return CATEGORIES[sport].map(([label, value, detail, involved = value]) => ({
    label,
    unit: UNITS[label],
    sides: box.teams.map(team => {
      let best = null;
      for (const entry of team.players) {
        const v = value(entry.line);
        if (!involved(entry.line)) continue;
        if (!best || v > best.v) best = {v, entry};
      }
      if (!best) return null;
      return {num: cut(best.entry.player.num, 4), name: cut(best.entry.player.name, 60), stat: String(best.v), detail: cut(detail(best.entry.line).trim(), 40)};
    }),
  }));
}

export function leadersFull(draft, {live, stats}) {
  const sport = live.sport;
  const kicker = cut(draft.kicker, 60) || autoKicker(live.games[sport].period);
  const list = stats && stats.sport === sport && stats.events.length ? leaders(sport, stats) : [];
  return base('leaders', {...draft, kicker, side: -1}, {leaders: list.map(row => ({label: row.label, unit: row.unit, left: row.sides[0], right: row.sides[1]}))});
}
