// Scoreboard camera feed (ScoreSight and similar OCR tools). The tool POSTs its
// readings to /api/feed; box names are matched to scorebug fields the same way
// ScoreSight names them ("Home Score", "Time", "Shot Clock", …). Only values
// that changed since the last reading are applied, so manual corrections stick
// until the scoreboard changes again.
import {interpret} from './serial.js';

const ROLES = {
  homeScore: ['homescore', 'scorehome', 'home', 'homepoints', 'pointshome', 'hometeam', 'hometeamscore'],
  awayScore: ['awayscore', 'scoreaway', 'away', 'guestscore', 'scoreguest', 'guest', 'guests', 'visitorscore', 'visitorsscore',
    'scorevisitor', 'scorevisitors', 'visitor', 'visitors', 'awaypoints', 'guestpoints', 'awayteam', 'awayteamscore'],
  clock: ['time', 'clock', 'gameclock', 'gametime', 'timer', 'mainclock', 'periodclock', 'periodtime'],
  period: ['period', 'quarter', 'qtr', 'half', 'per', 'periodnumber'],
  aux: ['shotclock', 'shottime', 'shot', 'possessionclock', 'playclock', 'play'],
  homeFouls: ['homefouls', 'foulshome', 'hometeamfouls', 'homefoul', 'foulhome', 'homebonus'],
  awayFouls: ['awayfouls', 'foulsaway', 'awayteamfouls', 'awayfoul', 'foulaway', 'guestfouls', 'foulsguest', 'guestfoul', 'visitorfouls', 'visitorsfouls', 'foulsvisitor'],
  homeTimeouts: ['hometimeouts', 'timeoutshome', 'hometimeout', 'hometol', 'hometimeoutsleft'],
  awayTimeouts: ['awaytimeouts', 'timeoutsaway', 'awaytimeout', 'awaytol', 'awaytimeoutsleft', 'guesttimeouts', 'timeoutsguest', 'guesttimeout', 'guesttol', 'visitortimeouts', 'visitorstimeouts'],
  down: ['down', 'downs'],
  distance: ['togo', 'yardstogo', 'distance', 'yards', 'ytg'],
  ballOn: ['ballon', 'ballposition', 'yardline', 'ball'],
  homePoss: ['homepossession', 'homeposs', 'possessionhome', 'posshome', 'homeball'],
  awayPoss: ['awaypossession', 'awayposs', 'possessionaway', 'possaway', 'awayball', 'guestpossession', 'guestposs', 'visitorpossession'],
};
const ROLE_OF = Object.fromEntries(Object.entries(ROLES).flatMap(([role, names]) => names.map(name => [name, role])));
export const roleOf = name => ROLE_OF[String(name).toLowerCase().replace(/[^a-z0-9]/g, '')] || null;

const GOOD = new Set(['Success', 'SameNoChange']);

// JSON (Full) is [{name, text, state}], JSON (Simple key-value) is {name: text},
// GET sends the values as query parameters.
export function readings(body, query) {
  const out = {};
  if (Array.isArray(body)) {
    for (const item of body) {
      if (!item || typeof item.name !== 'string') continue;
      if (item.state && !GOOD.has(item.state)) continue;
      if (item.text === null || item.text === undefined) continue;
      out[item.name] = String(item.text);
    }
  } else if (body && typeof body === 'object') {
    for (const [name, text] of Object.entries(body)) if (text !== null && typeof text !== 'object') out[name] = String(text);
  }
  if (query) for (const [name, text] of query) if (name !== 'key') out[name] = text;
  return Object.fromEntries(Object.entries(out).slice(0, 40).map(([k, v]) => [k.slice(0, 40), v.slice(0, 40)]));
}

const flag = text => /^(1|y|yes|true|on|x|\*|●|<|>|◀|▶)$/i.test(String(text).trim());

// Mutates the live doc. Returns true if anything changed.
export function applyFeed(live, values, now) {
  const feed = live.feed = {enabled: false, homeSide: 1, last: {}, track: null, raw: {}, seenAt: 0, ...(live.feed || {})};
  const before = JSON.stringify(feed.raw);
  feed.raw = values;
  const rawChanged = before !== JSON.stringify(values);
  const stale = now - feed.seenAt > 5000;
  feed.seenAt = now;
  if (!feed.enabled) return rawChanged || stale;

  const sport = live.sport;
  const g = live.games[sport];
  const home = feed.homeSide === 0 ? 0 : 1;
  const away = 1 - home;
  const byRole = {};
  for (const [name, text] of Object.entries(values)) {
    const role = roleOf(name);
    if (role && !(role in byRole)) byRole[role] = text;
  }
  let changed = rawChanged || stale;
  const fresh = role => role in byRole && feed.last[role] !== byRole[role];
  const int = (role, max) => {
    const n = interpret('int', byRole[role]);
    return n === null ? null : Math.max(0, Math.min(max, n));
  };
  const set = (role, apply) => {
    if (!fresh(role)) return;
    const result = apply(byRole[role]);
    feed.last[role] = byRole[role];
    if (result !== false) changed = true;
  };
  set('homeScore', () => { const n = int('homeScore', 299); if (n === null) return false; g.score[home] = n; });
  set('awayScore', () => { const n = int('awayScore', 299); if (n === null) return false; g.score[away] = n; });
  set('homeTimeouts', () => { const n = int('homeTimeouts', 9); if (n === null) return false; g.timeouts[home] = n; });
  set('awayTimeouts', () => { const n = int('awayTimeouts', 9); if (n === null) return false; g.timeouts[away] = n; });
  set('period', text => { const p = interpret('period', text); if (!p) return false; g.period = p; });
  if (sport === 'basketball') {
    set('homeFouls', () => { const n = int('homeFouls', 99); if (n === null) return false; g.fouls[home] = n; });
    set('awayFouls', () => { const n = int('awayFouls', 99); if (n === null) return false; g.fouls[away] = n; });
  } else {
    set('down', () => { const n = int('down', 4); if (!n) return false; g.down = n; });
    set('distance', text => { const v = text.trim(); if (!v) return false; g.distance = /^g/i.test(v) ? 'Goal' : v.slice(0, 6); });
    set('ballOn', text => { g.ballOn = text.trim().slice(0, 12); });
    if (fresh('homePoss') || fresh('awayPoss')) {
      const h = flag(byRole.homePoss ?? ''), a = flag(byRole.awayPoss ?? '');
      g.possession = h && !a ? home : a && !h ? away : -1;
      if ('homePoss' in byRole) feed.last.homePoss = byRole.homePoss;
      if ('awayPoss' in byRole) feed.last.awayPoss = byRole.awayPoss;
      changed = true;
    }
  }
  set('aux', text => {
    const n = interpret('int', text);
    if (n === null) return false;
    const previous = interpret('int', feed.last.aux ?? '');
    const ms = Math.max(0, Math.min(99, n)) * 1000;
    // Counting down = running; reset or frozen = stopped.
    g.aux = previous !== null && n < previous && n > 0 ? {ms, end: now + ms, floor: Math.max(0, ms - 999)} : {ms, end: 0};
    g.showAux = true;
  });

  // Game clock: running while the reading counts down; stopped when it holds
  // still. `floor` stops the overlay from running ahead of the scoreboard if
  // readings pause (e.g. "only send changes" in ScoreSight).
  if ('clock' in byRole) {
    const text = byRole.clock;
    const ms = interpret('clock', text);
    if (ms !== null) {
      const step = /\./.test(text) ? 99 : 999;
      const track = feed.track || {value: null, changedAt: 0, running: false};
      if (ms !== track.value) {
        const running = track.value !== null && ms < track.value && track.value - ms <= 5000;
        feed.track = {value: ms, changedAt: now, running};
        g.game = running ? {ms, end: now + ms, floor: Math.max(0, ms - step)} : {ms, end: 0};
        changed = true;
      } else if (track.running && now - track.changedAt > (step === 99 ? 700 : 1700)) {
        feed.track = {...track, running: false};
        g.game = {ms, end: 0};
        changed = true;
      }
    }
  }
  return changed;
}
