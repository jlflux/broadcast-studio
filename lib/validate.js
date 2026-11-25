// Structural checks on documents before they are saved. The overlay renders all
// text with textContent and checks image URLs itself, so these checks exist to
// keep a buggy or stale client from saving something the overlay can't draw.
import {SPORTS} from './defaults.js';

export const LIMITS = {live: 1_500_000, ticker: 400_000, library: 4_000_000, stats: 2_500_000, photo: 450_000, gamecast: 2_500_000};

export function docKind(key) {
  if (['live', 'ticker', 'library', 'stats', 'gamecast'].includes(key)) return key;
  if (/^photo:[a-z0-9-]{6,40}$/.test(key)) return 'photo';
  return null;
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const str = (value, max = 200) => typeof value === 'string' && value.length <= max;
const int = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const hex = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const clock = value => isObject(value) && Number.isFinite(value.ms) && Number.isFinite(value.end) && value.ms >= 0 && value.end >= 0;
const pair = (list, max) => Array.isArray(list) && list.length === 2 && list.every(value => int(value, 0, max));
const image = value => value === '' || (typeof value === 'string' && value.length < 600_000 &&
  (/^https:\/\/[^\s"'<>]+$/.test(value) || /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(value)));

function validTeam(team) {
  return isObject(team) && str(team.name, 60) && str(team.short, 8) && str(team.rank, 4) && str(team.record ?? '', 16) &&
    hex(team.color) && hex(team.accent) && image(team.logo);
}

function validGame(sport, game) {
  if (!isObject(game) || !pair(game.score, 299) || !pair(game.timeouts, 9) || !str(game.period, 8) ||
      !clock(game.game) || !clock(game.aux) || typeof game.showAux !== 'boolean' || typeof game.showClock !== 'boolean' ||
      ![-1, 0, 1].includes(game.possession) || !str(game.status, 40)) return false;
  if (sport === 'football') return int(game.down, 1, 4) && str(game.distance, 6) && str(game.ballOn, 12);
  return pair(game.fouls, 99) && [-1, 0, 1].includes(game.arrow);
}

function validGraphic(graphic) {
  if (graphic === null) return true;
  if (!isObject(graphic) || !['player', 'compare', 'message'].includes(graphic.type) || !str(graphic.title, 90)) return false;
  if (graphic.rows !== undefined && (!Array.isArray(graphic.rows) || graphic.rows.length > 6 ||
      !graphic.rows.every(row => isObject(row) && str(row.label, 40) && str(row.left ?? '', 30) && str(row.right ?? '', 30)))) return false;
  if (graphic.photoPos !== undefined && graphic.photoPos !== '' && !/^(left|center|right) (top|center|bottom)$/.test(graphic.photoPos)) return false;
  return [-1, 0, 1].includes(graphic.side ?? -1) && image(graphic.image ?? '') && image(graphic.photo ?? '');
}

const WIPE_STYLES = ['slash', 'stripes', 'iris'];
const FULL_KINDS = ['matchup', 'lineup', 'keys', 'stats', 'leaders'];
const side = value => [-1, 0, 1].includes(value ?? -1);
const optionalStr = (value, max) => value === undefined || str(value, max);

function validTransition(t) {
  if (t === null || t === undefined) return true;
  return isObject(t) && str(t.id, 40) && WIPE_STYLES.includes(t.style) && ['normal', 'fast'].includes(t.speed) && side(t.side) && Number.isFinite(t.at);
}

function validLeader(entry) {
  return entry === null || (isObject(entry) && str(entry.num, 4) && str(entry.name, 60) && str(entry.stat, 12) && optionalStr(entry.detail, 40));
}

function validFull(full) {
  if (full === null || full === undefined) return true;
  if (!isObject(full) || !FULL_KINDS.includes(full.kind) || !str(full.id, 40) || !Number.isFinite(full.showAt) ||
      !Number.isFinite(full.hideAt ?? 0) || !side(full.side)) return false;
  if (!optionalStr(full.kicker, 60) || !optionalStr(full.title, 90) || !optionalStr(full.subtitle, 140) || !optionalStr(full.period, 8)) return false;
  if (full.players !== undefined && !(Array.isArray(full.players) && full.players.length <= 12 && full.players.every(p => isObject(p) &&
      str(p.num, 4) && str(p.name, 60) && str(p.pos ?? '', 12) && str(p.cls ?? '', 12) && image(p.photo ?? '') &&
      (!p.photoPos || /^(left|center|right) (top|center|bottom)$/.test(p.photoPos))))) return false;
  if (full.points !== undefined && !(Array.isArray(full.points) && full.points.length <= 5 && full.points.every(p => str(p, 140)))) return false;
  if (full.rows !== undefined && !(Array.isArray(full.rows) && full.rows.length <= 10 &&
      full.rows.every(row => isObject(row) && str(row.label, 40) && str(row.left ?? '', 30) && str(row.right ?? '', 30)))) return false;
  if (full.score !== undefined && !pair(full.score, 299)) return false;
  if (full.line !== undefined && !(isObject(full.line) && Array.isArray(full.line.columns) && full.line.columns.length <= 8 &&
      full.line.columns.every(c => str(c, 6)) && Array.isArray(full.line.rows) && full.line.rows.length === 2 &&
      full.line.rows.every(row => Array.isArray(row) && row.length === full.line.columns.length && row.every(n => int(n, 0, 299))))) return false;
  if (full.leaders !== undefined && !(Array.isArray(full.leaders) && full.leaders.length <= 5 &&
      full.leaders.every(row => isObject(row) && str(row.label, 30) && optionalStr(row.unit, 8) && validLeader(row.left) && validLeader(row.right)))) return false;
  return true;
}

export function validLive(doc) {
  if (!isObject(doc) || doc.schema !== 2 || !SPORTS.includes(doc.sport) || typeof doc.bugVisible !== 'boolean') return false;
  if (!Array.isArray(doc.teams) || doc.teams.length !== 2 || !doc.teams.every(validTeam)) return false;
  if (!isObject(doc.games) || !SPORTS.every(sport => validGame(sport, doc.games[sport]))) return false;
  const s = doc.settings;
  if (!isObject(s) || !int(s.football?.minutes, 1, 30) || !int(s.football?.timeouts, 0, 9) || !int(s.football?.playClock, 5, 99) ||
      !int(s.basketball?.minutes, 1, 30) || !int(s.basketball?.timeouts, 0, 9) || !int(s.basketball?.shotClock, 5, 99) ||
      !int(s.basketball?.bonusAt, 1, 20)) return false;
  const style = doc.style;
  if (!isObject(style) || !['broadcast', 'corner', 'ribbon', 'badge'].includes(style.layout) || !str(style.position, 16) ||
      !int(style.scale, 40, 200) || !int(style.nudgeX, -1920, 1920) || !int(style.nudgeY, -1080, 1080) ||
      !hex(style.dark) || !hex(style.accent) || (style.panel !== undefined && !hex(style.panel)) ||
      (style.possColor !== undefined && !hex(style.possColor)) || (style.shotColor !== undefined && !hex(style.shotColor)) ||
      (style.wipe !== undefined && !WIPE_STYLES.includes(style.wipe)) || (style.wipeSpeed !== undefined && !['normal', 'fast'].includes(style.wipeSpeed)) ||
      !image(style.brandLogo ?? '')) return false;
  if (!validTransition(doc.transition) || !validFull(doc.full)) return false;
  if (doc.banner !== null && !(isObject(doc.banner) && str(doc.banner.text, 80) && Number.isFinite(doc.banner.until) &&
      [-1, 0, 1].includes(doc.banner.side) &&
      // optional custom colors and sponsor logo (saved banners)
      (doc.banner.color === undefined || doc.banner.color === '' || hex(doc.banner.color)) &&
      (doc.banner.textColor === undefined || doc.banner.textColor === '' || hex(doc.banner.textColor)) &&
      image(doc.banner.image ?? ''))) return false;
  return validGraphic(doc.graphic);
}

export function validDoc(kind, doc) {
  if (!isObject(doc)) return false;
  switch (kind) {
    case 'live': return validLive(doc);
    case 'ticker': return Array.isArray(doc.games) && Array.isArray(doc.sheets) && Array.isArray(doc.leagues);
    case 'library': return Array.isArray(doc.teams) && Array.isArray(doc.rosters) && Array.isArray(doc.presets);
    case 'stats': return SPORTS.includes(doc.sport) && Array.isArray(doc.events) && Array.isArray(doc.teams) && doc.teams.length === 2;
    case 'photo': return image(doc.data) && doc.data !== '';
    // Virtual gamecast (/gamecast): the page's game state, play log and display settings.
    case 'gamecast': return doc.schema === 1 && (doc.state === null || isObject(doc.state)) && Array.isArray(doc.log) && doc.log.length <= 400 &&
      isObject(doc.cue) && Number.isSafeInteger(doc.cue.seq) && (doc.view === undefined || doc.view === null || isObject(doc.view));
    default: return false;
  }
}
