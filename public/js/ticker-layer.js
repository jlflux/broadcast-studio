// Score ticker layer, ported from jlflux/ticker. Settings come from the studio's
// "ticker" document instead of config.js. Sources: Google Sheets (same template
// as the original ticker), ESPN scoreboards, hand-entered games, and optionally
// the game on the scorebug.
import {esc, readable} from './common.js';

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/';
export const LEAGUES = {
  'nfl': {label: 'NFL', path: 'football/nfl'},
  'college-football': {label: 'NCAAF', path: 'football/college-football', params: {groups: 80, limit: 300}},
  'college-football-top25': {label: 'TOP 25', path: 'football/college-football', params: {groups: 80, limit: 300}, filter: 'ranked'},
  'nba': {label: 'NBA', path: 'basketball/nba'},
  'wnba': {label: 'WNBA', path: 'basketball/wnba'},
  'mens-college-basketball': {label: 'NCAAM', path: 'basketball/mens-college-basketball', params: {groups: 50, limit: 400}},
  'womens-college-basketball': {label: 'NCAAW', path: 'basketball/womens-college-basketball', params: {groups: 50, limit: 400}},
  'mlb': {label: 'MLB', path: 'baseball/mlb'},
  'nhl': {label: 'NHL', path: 'hockey/nhl'},
};

function fromEspn(feed, ev) {
  const comp = (ev.competitions || [])[0];
  if (!comp || !comp.competitors || comp.competitors.length < 2) return null;
  const type = (comp.status || ev.status || {}).type || {};
  const state = type.state || 'pre';
  const final = state === 'post' && type.completed !== false;
  let teams = comp.competitors.slice(0, 2).map(c => {
    const t = c.team || {};
    const rank = c.curatedRank && c.curatedRank.current;
    return {
      name: t.shortDisplayName || t.name || t.abbreviation, homeAway: c.homeAway,
      keys: [t.abbreviation, t.shortDisplayName, t.displayName, t.name, t.location].filter(Boolean).map(s => s.toLowerCase()),
      score: state === 'pre' ? '' : String(c.score ?? ''), logo: t.logo || '', color: t.color ? `#${t.color}` : '',
      rank: rank >= 1 && rank <= 25 ? rank : null, record: ((c.records || [])[0] || {}).summary || '', winner: c.winner === true,
    };
  });
  const away = teams.find(t => t.homeAway === 'away');
  const home = teams.find(t => t.homeAway === 'home');
  if (away && home) teams = [away, home];
  if (feed.filter === 'ranked' && !teams.some(t => t.rank)) return null;
  return {
    id: `${feed.id}:${ev.id}`, league: feed.label, state, final, teams,
    start: ev.date ? new Date(ev.date) : null, timeValid: comp.timeValid !== false,
    network: ((comp.broadcasts || [])[0] || {}).names?.[0] || '',
    detail: type.shortDetail || type.detail || type.description || '',
    postponed: /POSTPONED|CANCELED|CANCELLED|SUSPENDED|DELAYED/.test(type.name || ''),
  };
}

// One hand-typed game (sheet row or studio entry) → normalized game.
function typedGame(id, row, fallbackLeague) {
  const away = String(row.away || '').trim(), home = String(row.home || '').trim();
  if (!away || !home || /^(n|no|false|0|hide)$/i.test(String(row.show ?? ''))) return null;
  const status = String(row.status || '').trim().replace(/^(\d{1,2}:\d{2}):00(\s*[AP]M)?$/i, '$1$2');
  const as = String(row.awayScore ?? '').trim(), hs = String(row.homeScore ?? '').trim();
  const final = /^final/i.test(status);
  const state = final ? 'post' : as !== '' || hs !== '' ? 'in' : 'pre';
  const color = value => /^[0-9a-f]{6}$/i.test(value || '') ? `#${value}` : (value || '');
  const mk = (name, score, side) => ({
    name, score, keys: [name.toLowerCase()], logo: row[side + 'Logo'] || '', rank: parseInt(row[side + 'Rank'], 10) || null,
    color: color(row[side + 'Color']), record: row[side + 'Record'] || '', winner: false,
  });
  const teams = [mk(away, as, 'away'), mk(home, hs, 'home')];
  if (final) {
    const a = parseFloat(as), h = parseFloat(hs);
    if (a > h) teams[0].winner = true; else if (h > a) teams[1].winner = true;
  }
  return {id, league: row.league || fallbackLeague, state, final, teams, start: null, timeValid: false, network: '',
    detail: status || (state === 'in' ? 'LIVE' : ''), typed: true, postponed: /postpon|cancel|suspend|delay/i.test(status)};
}

function fromSheet(feed, rows) {
  const [header, ...body] = rows;
  if (!header) return [];
  const col = Object.fromEntries(header.map((h, i) => [h.trim().toLowerCase().replace(/\s+/g, '_'), i]));
  const get = (r, k) => (col[k] != null ? (r[col[k]] || '').trim() : '');
  return body.map(r => typedGame(`${feed.id}:${get(r, 'away')}@${get(r, 'home')}`, {
    league: get(r, 'league'), away: get(r, 'away'), home: get(r, 'home'), awayScore: get(r, 'away_score'), homeScore: get(r, 'home_score'),
    status: get(r, 'status'), show: get(r, 'show'), awayRank: get(r, 'away_rank'), homeRank: get(r, 'home_rank'),
    awayRecord: get(r, 'away_record'), homeRecord: get(r, 'home_record'), awayColor: get(r, 'away_color'), homeColor: get(r, 'home_color'),
    awayLogo: get(r, 'away_logo'), homeLogo: get(r, 'home_logo'),
  }, feed.label)).filter(Boolean);
}

export function sheetCsvUrl(url) {
  const m = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  if (!m || /\/pub(\?|$)|output=csv|tqx=out:csv/.test(url)) return url;
  const gid = (url.match(/[#?&]gid=(\d+)/) || [])[1];
  return `https://docs.google.com/spreadsheets/d/${m[1]}/gviz/tq?tqx=out:csv${gid ? `&gid=${gid}` : ''}`;
}

function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

async function get(url, asText) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(url, {cache: 'no-store', signal: ctl.signal});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return asText ? await res.text() : await res.json();
  } finally { clearTimeout(timer); }
}

const DAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
function status(g) {
  if (g.state === 'pre' && g.start && !g.typed) {
    const d = g.start, now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const daysOut = (d - now) / 864e5;
    const day = sameDay ? 'TODAY' : daysOut < 6 ? DAY[d.getDay()] : `${d.getMonth() + 1}/${d.getDate()}`;
    const time = g.timeValid ? d.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'}) : 'TBD';
    return {top: g.timeValid && sameDay ? time : day, bottom: g.timeValid && sameDay ? g.network : (g.timeValid ? time : 'TBD'), cls: 'pre'};
  }
  const detail = String(g.detail || '').toUpperCase();
  if (g.final) return {top: detail || 'FINAL', bottom: '', cls: 'final'};
  if (g.postponed) return {top: detail, bottom: '', cls: 'pre'};
  const cls = g.state === 'in' ? 'live' : g.state === 'pre' ? 'pre' : '';
  let m = detail.match(/^(.+?)\s+-\s+(.+)$/);
  if (m) return {top: m[2], bottom: m[1], cls};
  const PERIOD = '(Q[1-4]|[1-4](?:ST|ND|RD|TH)|OT\\d?|\\d?OT|HALF)';
  if ((m = detail.match(new RegExp(`^${PERIOD}\\s+(\\d{1,2}:\\d{2}(?:\\.\\d)?)$`)))) return {top: m[1], bottom: m[2], cls};
  if ((m = detail.match(new RegExp(`^(\\d{1,2}:\\d{2}(?:\\.\\d)?)\\s+${PERIOD}$`)))) return {top: m[2], bottom: m[1], cls};
  return {top: detail, bottom: '', cls};
}

export function createTicker(root, labelEl, stage) {
  let cfg = null;
  let feeds = [];
  let feedKey = '';
  let liveGame = null;
  const store = new Map();
  let firstLoadDone = false;
  let currentId = null, currentLabel = null, queue = [], pos = 0;
  let rotateTimer = 0, refreshTimer = 0, refreshEvery = 0, rotateEvery = 0;

  const teamFilter = () => (cfg.teams || []).map(t => String(t).toLowerCase());

  async function loadFeed(feed) {
    try {
      let games;
      if (feed.type === 'espn') {
        const params = new URLSearchParams({...(feed.params || {}), _: Date.now()});
        const data = await get(`${ESPN}${feed.path}/scoreboard?${params}`);
        games = (data.events || []).map(ev => fromEspn(feed, ev)).filter(Boolean);
      } else {
        games = fromSheet(feed, parseCsv(await get(feed.url, true)));
      }
      store.set(feed.id, games);
    } catch (err) {
      console.warn(`[ticker] ${feed.label}: ${err.message} (keeping last scores)`);
    }
  }
  async function refreshAll() {
    await Promise.all(feeds.map(loadFeed));
    firstLoadDone = true;
  }

  function visible(g) {
    const filter = teamFilter();
    if (filter.length && !g.typed && !g.teams.some(t => t.keys.some(k => filter.includes(k)))) return false;
    if (g.typed || !g.start) return g.state !== 'pre' || cfg.showUpcoming;
    const hrs = (g.start - Date.now()) / 3.6e6;
    if (g.state === 'pre') return cfg.showUpcoming && hrs <= 24 && hrs > -12;
    if (g.state === 'post') return -hrs <= 35;
    return true;
  }

  function currentGames() {
    const typed = (cfg.games || []).map((row, i) => typedGame(`studio:${i}:${row.away}@${row.home}`, row, cfg.title)).filter(Boolean);
    const fed = feeds.flatMap(f => store.get(f.id) || []);
    const list = [...(cfg.includeLive && liveGame ? [liveGame] : []), ...typed, ...fed];
    return list.filter(visible);
  }

  function teamHtml(t, g) {
    const decided = g.final && g.teams.some(x => x.winner);
    const cls = decided ? (t.winner ? 'winner' : 'loser') : '';
    const logo = cfg.showLogos && t.logo && /^(https:|data:image\/)/.test(t.logo) ? `<img class="tk-logo" src="${esc(t.logo)}" alt="" onerror="this.remove()">` : '';
    const rank = cfg.showRankings && t.rank ? `<span class="tk-rank">${esc(t.rank)}</span>` : '';
    const rec = cfg.showRecords && t.record ? `<span class="tk-record">${esc(t.record)}</span>` : '';
    return `<div class="tk-team ${cls}" style="--team:${esc(t.color || 'transparent')}"><span class="tk-stripe"></span>${logo}
      <span class="tk-name-wrap"><span class="tk-name">${rank}${esc(t.name)}</span>${rec}</span>
      <span class="tk-score" data-score="${esc(t.score)}">${esc(t.score)}</span><span class="tk-arrow">&#9664;</span></div>`;
  }
  function cardHtml(g) {
    const s = status(g);
    return `${teamHtml(g.teams[0], g)}${teamHtml(g.teams[1], g)}<div class="tk-status ${s.cls}"><span class="top">${esc(s.top)}</span>${s.bottom ? `<span class="bottom">${esc(s.bottom)}</span>` : ''}</div>`;
  }
  function setLabel(text) {
    if (text === currentLabel) return;
    currentLabel = text;
    labelEl.classList.add('swap');
    setTimeout(() => { labelEl.textContent = text; labelEl.classList.remove('swap'); }, 200);
  }
  function show(html, id, animate) {
    const old = stage.querySelector('.tk-card.active');
    if (!animate && old) {
      const before = [...old.querySelectorAll('.tk-score')].map(e => e.dataset.score);
      old.innerHTML = html;
      old.querySelectorAll('.tk-score').forEach((e, i) => {
        if (before[i] !== undefined && before[i] !== e.dataset.score) e.classList.add('flash');
      });
      return;
    }
    const card = document.createElement('div');
    card.className = 'tk-card enter';
    card.innerHTML = html;
    stage.appendChild(card);
    void card.offsetWidth;
    card.classList.replace('enter', 'active');
    if (old) {
      old.classList.replace('active', 'exit');
      setTimeout(() => old.remove(), 700);
    }
    currentId = id;
  }

  function tick() {
    if (!cfg) return;
    const games = currentGames();
    if (!games.length) {
      queue = []; pos = 0;
      root.classList.toggle('gone', !cfg.visible || (cfg.hideWhenEmpty && firstLoadDone));
      setLabel(cfg.title);
      const msg = firstLoadDone || !feeds.length ? cfg.emptyMessage : 'Loading scores…';
      if (currentId !== '__empty' + msg) show(`<div class="tk-message">${esc(msg)}</div>`, '__empty' + msg, true);
      return;
    }
    root.classList.toggle('gone', !cfg.visible);
    if (pos >= queue.length) { queue = games.map(g => g.id); pos = 0; }
    const byKey = new Map(games.map(g => [g.id, g]));
    let g;
    while (pos < queue.length && !(g = byKey.get(queue[pos]))) pos++;
    if (!g) { queue = games.map(x => x.id); pos = 0; g = games[0]; }
    pos++;
    setLabel(g.league);
    show(cardHtml(g), g.id, g.id !== currentId || games.length > 1);
  }
  function refreshOnScreen() {
    if (!currentId || currentId.startsWith('__empty')) { tick(); return; }
    const g = currentGames().find(x => x.id === currentId);
    if (g) show(cardHtml(g), g.id, false); else tick();
  }

  return {
    configure(next) {
      const first = !cfg;
      cfg = next;
      root.hidden = false;
      root.className = cfg.layout === 'corner' ? `corner ${/^(top|bottom)-(left|right)$/.test(cfg.corner) ? cfg.corner : 'top-right'}` : '';
      root.classList.toggle('gone', !cfg.visible);
      root.style.setProperty('--accent', cfg.accentColor);
      root.style.setProperty('--accent-ink', readable(cfg.accentColor));
      root.style.setProperty('--winner', cfg.winnerColor);
      root.style.setProperty('--edge', `${cfg.edgeMargin}px`);
      const nextFeeds = [
        ...(cfg.leagues || []).filter(key => LEAGUES[key]).map(key => ({id: key, type: 'espn', ...LEAGUES[key]})),
        ...(cfg.sheets || []).filter(s => s && s.url).map((s, i) => ({id: `sheet${i}`, type: 'sheet', label: s.label || cfg.title, url: sheetCsvUrl(s.url)})),
      ];
      const key = JSON.stringify(nextFeeds);
      if (key !== feedKey) {
        feedKey = key;
        feeds = nextFeeds;
        store.clear();
        firstLoadDone = false;
        refreshAll().then(refreshOnScreen);
      }
      const seconds = Math.max(2, cfg.secondsPerGame || 6);
      if (rotateEvery !== seconds) { clearInterval(rotateTimer); rotateEvery = seconds; rotateTimer = setInterval(tick, seconds * 1000); }
      const refresh = Math.max(10, cfg.refreshSeconds || 20);
      if (refreshEvery !== refresh) {
        clearInterval(refreshTimer); refreshEvery = refresh;
        refreshTimer = setInterval(async () => { if (feeds.length) { await refreshAll(); refreshOnScreen(); } }, refresh * 1000);
      }
      if (first) { setLabel(cfg.title); tick(); } else refreshOnScreen();
    },
    // The game on the scorebug, so it can appear in the rotation.
    setLive(game) {
      const before = JSON.stringify(liveGame);
      liveGame = game;
      if (cfg && cfg.includeLive && JSON.stringify(game) !== before && currentId === game?.id) refreshOnScreen();
    },
  };
}
