// Data for the basketball scoresheet: which players go on it, their season
// stats, tonight's numbers from the stat keeper, and the running score.
import {boxScore, points} from './stats-engine.js';

// Season stat columns, in the order the sheet prints them.
export const SEASON = [
  ['ppg', 'PPG'], ['fgp', 'FG%'], ['tpm', "3's"], ['tpp', '3%'], ['ftm', 'FTM'], ['ftp', 'FT%'],
  ['reb', 'Reb'], ['rpg', 'Reb/G'], ['blk', 'Blk'], ['bpg', 'Blk/G'], ['stl', 'Stl'], ['apg', 'Ast/G'],
];
export const SEASON_KEYS = SEASON.map(([key]) => key);

const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const numberOf = p => { const n = parseInt(p.num, 10); return Number.isFinite(n) ? n : 1000; };
export const byNumber = list => [...list].sort((a, b) => numberOf(a) - numberOf(b) || String(a.name).localeCompare(String(b.name)));

// The saved roster entry for a stat keeper player: same id, else same number and name.
function savedMatch(player, saved) {
  return saved.find(p => p.id && p.id === player.id) ||
    saved.find(p => String(p.num) === String(player.num) && sameName(p.name, player.name)) ||
    saved.find(p => String(p.num) === String(player.num) && player.num !== '') || null;
}

// Players for one side. The stat keeper's roster when it's on basketball (its
// players are the ones plays point at); otherwise the saved roster. Season
// stats and pronunciations always come from the saved roster.
export function sheetPlayers(side, {stats, rosters}) {
  const saved = rosters[side]?.players || [];
  const fromStats = stats?.sport === 'basketball' && stats.teams[side]?.players.length ? stats.teams[side].players : null;
  const list = (fromStats || saved).map(p => {
    const match = fromStats ? savedMatch(p, saved) : p;
    return {...p, season: match?.season || p.season || null, say: match?.say || p.say || ''};
  });
  return byNumber(list);
}

export function rosterFor(name, library) {
  return (library?.rosters || []).find(r => r.sport === 'basketball' && sameName(r.name, name)) || null;
}

export const hasSeason = p => Boolean(p.season && SEASON_KEYS.some(key => String(p.season[key] ?? '').trim() !== ''));

// Season-table rows for one side: players with season stats, best scorers first.
export function seasonRows(players, limit) {
  const rows = players.filter(hasSeason).sort((a, b) => (parseFloat(b.season.ppg) || 0) - (parseFloat(a.season.ppg) || 0));
  return limit ? rows.slice(0, limit) : rows;
}

// Tonight's box line per player id, only when the stat keeper is on basketball.
export function gameLines(stats) {
  const lines = [new Map(), new Map()];
  if (stats?.sport !== 'basketball' || !stats.events.length) return lines;
  const box = boxScore('basketball', stats);
  box.teams.forEach((team, side) => team.players.forEach(entry => lines[side].set(entry.player.id, entry.line)));
  return lines;
}

// The cumulative point totals where a player's made threes ended (ringed on the sheet).
export function threeMarks(events, side, playerId) {
  const marks = new Set();
  let total = 0;
  for (const e of events) {
    if (e.team !== side || e.player !== playerId) continue;
    if (e.type === 'fg' && e.made) { total += e.three ? 3 : 2; if (e.three) marks.add(total); }
    if (e.type === 'ft' && e.made) total += 1;
  }
  return marks;
}

const halfOf = period => (/^(1st|2nd|Q1|Q2|1|2)$/i.test(String(period || '1st').trim()) ? 0 : 1);

// Running score by half: each team's column lists its new total after every
// score, with the scorer's number. [half][side] → [{score, num, ot}]
export function runningTotals(events, rosterBySide = [[], []]) {
  const totals = [0, 0];
  const halves = [[[], []], [[], []]];
  for (const e of events) {
    const p = points('basketball', e);
    if (!p) continue;
    totals[e.team] += p;
    const player = rosterBySide[e.team].find(x => x.id === e.player);
    halves[halfOf(e.period)][e.team].push({score: totals[e.team], num: player ? String(player.num) : '', pts: p, ot: /OT/i.test(e.period || '')});
  }
  return halves;
}

// ── Season stats paste ──────────────────────────────────────────────────────
// Takes a table copied from MaxPreps, a stats spreadsheet or a CSV, with a
// header row. Several pastes (scoring, rebounding, …) can each fill part.
const HEADERS = {
  num: ['#', 'no', 'no.', 'num', 'number', 'jersey'],
  name: ['name', 'player', 'athlete', 'athlete name', 'player name'],
  first: ['first', 'first name'],
  last: ['last', 'last name'],
  gp: ['gp', 'g', 'games', 'games played'],
  pts: ['pts', 'points', 'tp', 'tot pts'],
  ppg: ['ppg', 'pts/g', 'points per game', 'avg', 'pts avg'],
  fgp: ['fg%', 'fgpct', 'fg pct', 'fgp', 'fg %'],
  tpm: ['3pm', "3's", '3s', '3fgm', '3pt', '3-pt', '3ptm', '3pt made', '3fg', 'threes', '3p'],
  tpp: ['3p%', '3%', '3pt%', '3fg%', '3pct', '3-pt%', '3pt pct'],
  ftm: ['ftm', 'ft made'],
  ftp: ['ft%', 'ftpct', 'ft pct', 'ft %'],
  reb: ['reb', 'rebs', 'tot reb', 'trb', 'rebounds', 'tot', 'treb'],
  rpg: ['rpg', 'reb/g', 'rebs/g', 'rebounds per game'],
  blk: ['blk', 'blks', 'blocks', 'bs'],
  bpg: ['bpg', 'blk/g', 'blks/g'],
  stl: ['stl', 'stls', 'steals'],
  ast: ['ast', 'asst', 'assists', 'a'],
  apg: ['apg', 'ast/g', 'asst/g', 'assists per game'],
};
const COLUMN = Object.fromEntries(Object.entries(HEADERS).flatMap(([key, names]) => names.map(n => [n, key])));
const cell = text => String(text ?? '').trim().replace(/^"|"$/g, '');

function splitLine(line) {
  if (line.includes('\t')) return line.split('\t').map(cell);
  if (line.includes(',')) return line.split(',').map(cell);
  return line.trim().split(/\s{2,}/).map(cell);
}

export function parseSeasonTable(text) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim());
  let header = -1;
  let columns = [];
  for (let i = 0; i < lines.length && header < 0; i += 1) {
    const cells = splitLine(lines[i]).map(c => COLUMN[c.toLowerCase()] || null);
    if (cells.filter(Boolean).length >= 2 && (cells.includes('name') || cells.includes('num') || cells.includes('last'))) { header = i; columns = cells; }
  }
  if (header < 0) return [];
  const rows = [];
  for (const line of lines.slice(header + 1)) {
    const cells = splitLine(line);
    const row = {};
    columns.forEach((key, i) => { if (key && cells[i] !== undefined && cells[i] !== '') row[key] = cells[i]; });
    if (!row.name && (row.first || row.last)) row.name = [row.first, row.last].filter(Boolean).join(' ');
    if (row.num) row.num = row.num.replace(/\D/g, '');
    // MaxPreps puts "Jaylen Carter (Sr)" in the name column.
    if (row.name) row.name = row.name.replace(/\s*\((fr|so|jr|sr|\d+)\.?\)\s*$/i, '').trim();
    if (!row.name && !row.num) continue;
    if (/^(team|opponents?)?\s*(totals?|team|opponents?)$/i.test(row.name || '')) continue;
    rows.push(row);
  }
  return rows;
}

const fixed = (n, digits = 1) => (Number.isFinite(n) ? n.toFixed(digits) : '');
const pct = value => {
  if (value === undefined || value === '') return '';
  const n = parseFloat(String(value).replace('%', ''));
  if (!Number.isFinite(n)) return '';
  return `${Math.round(n <= 1 && !String(value).includes('%') && String(value).includes('.') ? n * 100 : n)}%`;
};

// A pasted row → the season fields it covers (per-game numbers worked out
// from totals and games played when only totals are there).
export function seasonFields(row) {
  const out = {};
  const gp = parseFloat(row.gp);
  const per = total => (Number.isFinite(gp) && gp > 0 && row[total] !== undefined ? fixed(parseFloat(row[total]) / gp) : '');
  if (row.ppg) out.ppg = row.ppg; else if (per('pts')) out.ppg = per('pts');
  if (row.fgp) out.fgp = pct(row.fgp);
  if (row.tpm) out.tpm = row.tpm;
  if (row.tpp) out.tpp = pct(row.tpp);
  if (row.ftm) out.ftm = row.ftm;
  if (row.ftp) out.ftp = pct(row.ftp);
  if (row.reb) out.reb = row.reb;
  if (row.rpg) out.rpg = row.rpg; else if (per('reb')) out.rpg = per('reb');
  if (row.blk) out.blk = row.blk;
  if (row.bpg) out.bpg = row.bpg; else if (per('blk')) out.bpg = per('blk');
  if (row.stl) out.stl = row.stl;
  if (row.apg) out.apg = row.apg; else if (per('ast')) out.apg = per('ast');
  for (const key of Object.keys(out)) out[key] = String(out[key]).slice(0, 7);
  return out;
}

// Match pasted rows to roster players by number, then by name (full or last).
export function matchSeason(rows, players) {
  const matched = [];
  const missed = [];
  for (const row of rows) {
    const last = String(row.name || '').trim().split(/\s+/).pop()?.toLowerCase();
    const player = (row.num && players.find(p => String(p.num) === row.num)) ||
      (row.name && players.find(p => sameName(p.name, row.name))) ||
      (last && players.filter(p => String(p.name).trim().split(/\s+/).pop()?.toLowerCase() === last).length === 1
        ? players.find(p => String(p.name).trim().split(/\s+/).pop()?.toLowerCase() === last) : null);
    const fields = seasonFields(row);
    if (player && Object.keys(fields).length) matched.push({player, fields});
    else if (!player) missed.push(row.name || `#${row.num}`);
  }
  return {matched, missed};
}
