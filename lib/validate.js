// Structural checks on documents before they are saved. The overlay renders all
// text with textContent and checks image URLs itself, so these checks exist to
// keep a buggy or stale client from saving something the overlay can't draw.
import {SPORTS} from './defaults.js';

export const LIMITS = {live: 1_500_000, ticker: 400_000, library: 4_000_000, stats: 2_500_000, photo: 450_000};

export function docKind(key) {
  if (['live', 'ticker', 'library', 'stats'].includes(key)) return key;
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
  return [-1, 0, 1].includes(graphic.side ?? -1) && image(graphic.image ?? '') && image(graphic.photo ?? '');
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
  if (!isObject(style) || !['broadcast', 'corner'].includes(style.layout) || !str(style.position, 16) ||
      !int(style.scale, 40, 200) || !int(style.nudgeX, -1920, 1920) || !int(style.nudgeY, -1080, 1080) ||
      !hex(style.dark) || !hex(style.accent)) return false;
  if (doc.banner !== null && !(isObject(doc.banner) && str(doc.banner.text, 80) && Number.isFinite(doc.banner.until) &&
      [-1, 0, 1].includes(doc.banner.side))) return false;
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
    default: return false;
  }
}
