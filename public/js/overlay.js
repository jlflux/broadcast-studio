// OBS overlay: scorebug, banner, graphics, ticker, full-screens and wipes on a
// 1920×1080 canvas.
// URL: /overlay?layers=bug,banner,graphic,ticker,full,wipe#key=<overlay key>
// Leave out `layers` to show everything; list some to split them into
// separate OBS sources.
import {byId, clamp, clockText, mix, photoPosition, readable, remaining, running, setTeamColors, setText, shade, validImage, esc} from './common.js';
import {createTicker} from './ticker-layer.js';
import {fitText, renderFull, renderWipe} from './full-layer.js';
import {coverAt, fullUp, wipeMs, wipeOver} from './transitions.js';

const params = new URLSearchParams(location.search);
const layers = new Set((params.get('layers') || 'bug,banner,graphic,ticker,full,wipe').split(',').map(s => s.trim()));
const key = new URLSearchParams(location.hash.slice(1)).get('key');
const canvas = byId('canvas');
// Preview mode (used inside the control panel): shows a graphic the control
// panel sends with postMessage instead of the one on air.
const previewMode = params.get('preview') === '1';
let previewGraphic = null;
let previewFull = null;

let live = null;
let tickerDoc = null;
let version = '';
let offset = 0;
const now = () => Date.now() + offset;

function fit() {
  canvas.style.setProperty('--scale', Math.min(innerWidth / 1920, innerHeight / 1080));
}
addEventListener('resize', fit);
fit();

const ticker = layers.has('ticker') ? createTicker(byId('ticker'), byId('tkLabel'), byId('tkStage')) : null;

async function poll() {
  const start = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 4500);
  try {
    const response = await fetch('/api/overlay', {
      headers: {Authorization: 'Bearer ' + key, ...(version ? {'X-Doc-Version': version} : {})},
      cache: 'no-store', signal: ctl.signal,
    });
    if (response.status === 401) { hideAll(); byId('keyMissing').hidden = false; return; }
    if (!response.ok || response.status === 204) return;
    const packet = await response.json();
    offset = packet.now - (start + Date.now()) / 2;
    version = `${packet.session}/${packet.revision}`;
    live = packet.live;
    tickerDoc = packet.ticker;
    paint();
  } catch {
    // Keep showing the last good state; the next poll will catch up.
  } finally {
    clearTimeout(timer);
  }
}

function hideAll() {
  ['bug', 'banner', 'stackGraphic', 'lowerGraphic', 'ticker', 'full', 'wipe'].forEach(id => { byId(id).hidden = true; });
}

// ── Scorebug ────────────────────────────────────────────────────────────────
function teamMarkup(i, layout) {
  const side = i === 0 ? 'left' : 'right';
  const name = `<div class="tname"><span class="rank" data-f="rank"></span><span class="name" data-f="name"></span><span class="record" data-f="record"></span></div>`;
  const mark = `<div class="mark"><img data-f="logo" alt=""><span class="short" data-f="short"></span></div>`;
  const meta = `<div class="meta"><div class="ticks" data-f="timeouts"></div><div class="fouls" data-f="foulsBox"><span data-f="fouls"></span><span class="bonus" data-f="bonus">BONUS</span></div></div>`;
  if (layout === 'corner') {
    return `<div class="team ${side}" id="team${i}"><span class="stripe"></span>${mark}${name}${meta}<span class="poss" data-f="poss"></span><div class="score" data-f="score"></div></div>`;
  }
  const fouls = `<div class="fouls" data-f="foulsBox"><span data-f="fouls"></span><span class="bonus" data-f="bonus">BONUS</span></div>`;
  if (layout === 'badge') {
    return `<div class="team ${side}" id="team${i}">${mark}<div class="info">${name}${fouls}</div><div class="score" data-f="score"></div><div class="ticks" data-f="timeouts"></div><span class="poss" data-f="poss"></span></div>`;
  }
  if (layout === 'ribbon') {
    return `<div class="team ${side}" id="team${i}"><div class="plate">${name}<div class="sub"><div class="ticks" data-f="timeouts"></div>${fouls}</div></div>${mark}<div class="score" data-f="score"></div><span class="poss" data-f="poss"></span></div>`;
  }
  return `<div class="team ${side}" id="team${i}"><div class="trow">${name}</div>${mark}<div class="score" data-f="score"></div><div class="meta"><div class="ticks" data-f="timeouts"></div></div><span class="poss" data-f="poss"></span></div>`;
}

// Possession arrows that sit inside the dark clock area, pointing at the team.
const ARROWS = ['<span class="parrow left" id="possLeft"></span>', '<span class="parrow right" id="possRight"></span>'];
const centerFouls = () => [0, 1].map(i => `<div class="cfoul" id="cfoul${i}"><div class="fouls" data-f="foulsBox"><span data-f="fouls"></span><span class="bonus" data-f="bonus">BONUS</span></div></div>`).join('');

function bugMarkup(layout, sport) {
  const timing = `<span class="period" id="period"></span><span class="clock" id="clock"></span><span class="aux" id="aux"></span>`;
  if (layout === 'corner') {
    return `${teamMarkup(0, layout)}${teamMarkup(1, layout)}<div class="foot">${timing}<span class="situation" id="situation"></span></div>`;
  }
  if (layout === 'badge') {
    return `${teamMarkup(0, layout)}${teamMarkup(1, layout)}<div class="center" id="center"><span class="parrow left" id="possLeft"></span><div class="timing">${timing}</div><div class="situation" id="situation"></div><span class="parrow right" id="possRight"></span></div>`;
  }
  if (layout === 'ribbon') {
    return `${teamMarkup(0, layout)}<div class="center" id="center"><div class="timing">${ARROWS[0]}${timing}${ARROWS[1]}</div><div class="situation" id="situation"></div></div>${teamMarkup(1, layout)}`;
  }
  // Broadcast: basketball team fouls sit along the bottom of the clock area,
  // each on its team's side, so the logos keep their full size.
  return `${teamMarkup(0, layout)}<div class="center" id="center"><div class="situation" id="situation"></div><div class="timing">${ARROWS[0]}${timing}${ARROWS[1]}</div>${sport === 'basketball' ? `<div class="cfouls">${centerFouls()}</div>` : ''}</div>${teamMarkup(1, layout)}`;
}

let bugShape = '';
let lastScores = null;
const field = (i, name) => byId('team' + i).querySelector(`[data-f="${name}"]`) || byId('cfoul' + i)?.querySelector(`[data-f="${name}"]`);

function paintBug() {
  const bug = byId('bug');
  const {style, sport, teams} = live;
  const game = live.games[sport];
  const shape = `${style.layout}/${sport}`;
  if (shape !== bugShape) {
    bugShape = shape;
    bug.className = `bug ${style.layout} ${sport}`;
    bug.innerHTML = bugMarkup(style.layout, sport);
    lastScores = null;
  }
  // A full-screen covers the scorebug, banner and lower thirds; they come back after.
  const show = live.bugVisible && layers.has('bug') && !covered();
  if (show) {
    bug.classList.remove('leaving');
    bug.hidden = false;
  } else if (!bug.hidden && !bug.classList.contains('leaving')) {
    bug.classList.add('leaving');
    setTimeout(() => { if (!live.bugVisible || !layers.has('bug') || covered()) bug.hidden = true; }, 340);
  }
  canvas.style.setProperty('--dark', style.dark);
  canvas.style.setProperty('--dark-hi', mix(style.dark, '#ffffff', 0.12));
  canvas.style.setProperty('--studio', style.accent);
  canvas.style.setProperty('--poss', style.possColor || '#e3262f');
  const panel = style.panel || '#f2f4f7';
  canvas.style.setProperty('--panel', panel);
  canvas.style.setProperty('--panel-lo', shade(panel, 0.86));
  canvas.style.setProperty('--panel-ink', readable(panel));

  const possession = sport === 'football' ? game.possession : game.arrow;
  const settings = live.settings[sport];
  teams.forEach((team, i) => {
    const panel = byId('team' + i);
    setTeamColors(panel, team);
    setText(field(i, 'name'), style.names === 'short' ? team.short : team.name);
    setText(field(i, 'rank'), team.rank);
    field(i, 'rank').hidden = !style.showRank || !team.rank;
    setText(field(i, 'record'), team.record);
    field(i, 'record').hidden = !style.showRecords || !team.record;
    const logo = field(i, 'logo');
    const hasLogo = validImage(team.logo);
    logo.hidden = !hasLogo;
    logo.classList.toggle('backed', Boolean(team.logoBacking));
    if (hasLogo && logo.getAttribute('src') !== team.logo) logo.src = team.logo;
    setText(field(i, 'short'), team.short);
    field(i, 'short').hidden = hasLogo;
    panel.classList.toggle('nologo', !hasLogo);
    const score = field(i, 'score');
    setText(score, game.score[i]);
    score.classList.toggle('wide', game.score[i] > 99);
    if (lastScores && lastScores[i] !== game.score[i] && game.score[i] > lastScores[i]) {
      score.classList.remove('flash'); void score.offsetWidth; score.classList.add('flash');
    }
    const total = settings.timeouts;
    const ticks = field(i, 'timeouts');
    const tickKey = `${game.timeouts[i]}/${total}`;
    if (ticks.dataset.key !== tickKey) {
      ticks.dataset.key = tickKey;
      ticks.replaceChildren(...Array.from({length: total}, (_, j) => {
        const mark = document.createElement('span');
        mark.className = j < game.timeouts[i] ? 'tick ready' : 'tick';
        return mark;
      }));
    }
    ticks.hidden = total === 0;
    const isHoops = sport === 'basketball';
    const foulsBox = field(i, 'foulsBox'); // not every layout shows team fouls for football
    if (foulsBox) foulsBox.hidden = !isHoops;
    if (isHoops && foulsBox) {
      setText(field(i, 'fouls'), style.layout === 'ribbon' || style.layout === 'badge' ? `${game.fouls[i]} FOULS` : `FOULS ${game.fouls[i]}`);
      field(i, 'bonus').hidden = game.fouls[1 - i] < settings.bonusAt;
    }
    field(i, 'poss').classList.toggle('on', possession === i);
  });
  lastScores = [...game.score];
  byId('possLeft')?.classList.toggle('on', possession === 0);
  byId('possRight')?.classList.toggle('on', possession === 1);

  // Status (TIMEOUT, REVIEW, FLAG) pops out of the clock box as a tab.
  const pop = byId('statusPop');
  const status = game.status && show ? game.status : '';
  const top = style.position.startsWith('top');
  pop.className = `pop ${style.layout}${top ? ' top' : ''}${status === 'FLAG' ? ' flag' : ''}${status ? ' on' : ''}`;
  if (status) setText('statusText', status);
  byId('bugWrap').className = (status ? 'popped' : '') + (top ? ' top' : '');

  // Situation: football down & distance, only while a team has the ball.
  let situation = '';
  if (sport === 'football' && game.down && game.possession >= 0) {
    const distance = /^goal$/i.test(game.distance) ? 'Goal' : game.distance;
    situation = `${['1st', '2nd', '3rd', '4th'][game.down - 1]} & ${distance}` + (game.ballOn && style.layout === 'corner' ? ` · ${game.ballOn}` : '');
  }
  const sit = byId('situation');
  setText(sit, situation);
  sit.classList.toggle('compact', situation.length > 13);
  const sitColor = possession >= 0 ? teams[possession].color : '#2a3442';
  sit.style.setProperty('--sit', sitColor);
  sit.style.setProperty('--sit-dark', shade(sitColor, 0.7));
  sit.style.setProperty('--sit-ink', readable(sitColor));
  byId('center')?.classList.toggle('nosit', !situation);
  setText('period', game.period);
  byId('aux').hidden = !game.showAux;
  byId('center')?.classList.toggle('noaux', !game.showAux);
  // Football: the play clock takes the color of the team with the ball. Basketball's
  // possession arrow is the alternating-possession arrow, not who has the ball,
  // so the shot clock uses one color set in the Style tab.
  const auxColor = sport === 'basketball' ? style.shotColor || '#aeb8c6' : possession >= 0 ? teams[possession].color : '#ffffff44';
  byId('aux').style.setProperty('--aux', auxColor);
  byId('clock').hidden = !game.showClock;

  // A bottom-bar ticker sits under the bug and lower thirds, so lift them.
  const tickerBar = tickerDoc?.visible && tickerDoc.layout !== 'corner';
  canvas.style.setProperty('--tk-lift', tickerBar ? '72px' : '0px');

  // Position, scale and nudge.
  const stack = byId('stack');
  stack.className = /^(top|bottom)-(left|center|right)$/.test(style.position) ? style.position : 'bottom-center';
  const centered = style.position.endsWith('center');
  stack.style.transform = `${centered ? 'translateX(-50%) ' : ''}translate(${style.nudgeX}px, ${-style.nudgeY}px) scale(${clamp(style.scale, 40, 200) / 100})`;
}

let wasCovered = false;
function tick() {
  if (!live || bugShape === '') return;
  // Full-screens go up and down on a schedule (under a wipe), so check often.
  const up = live.full ? fullUp(live.full, now()) : false;
  if (up !== wasCovered) { wasCovered = up; paint(); return; }
  const game = live.games[live.sport];
  const t = now();
  const ms = remaining(game.game, t);
  const clock = byId('clock');
  setText(clock, clockText(ms, live.sport === 'basketball'));
  clock.classList.toggle('stopped', !running(game.game, t));
  const aux = Math.ceil(remaining(game.aux, t) / 1000);
  setText('aux', aux);
  byId('aux').classList.toggle('low', aux <= 5);
  // Banners with a timer expire on their own.
  const banner = live.banner;
  if (banner && banner.until && t > banner.until && !byId('banner').hidden) byId('banner').hidden = true;
}

// ── Banner ──────────────────────────────────────────────────────────────────
function paintBanner() {
  const element = byId('banner');
  const banner = live.banner;
  const show = layers.has('banner') && banner && (!banner.until || now() < banner.until) && !covered();
  if (!show) { element.hidden = true; element.dataset.id = ''; return; }
  // Saved banners can carry their own colors and a sponsor logo.
  const color = banner.color || (banner.side >= 0 ? live.teams[banner.side].color : live.style.accent);
  element.style.setProperty('--b', color);
  element.style.setProperty('--b-dark', shade(color, 0.72));
  element.style.setProperty('--b-ink', banner.textColor || readable(color));
  const img = byId('bannerImage');
  img.hidden = !validImage(banner.image);
  if (validImage(banner.image) && img.getAttribute('src') !== banner.image) img.src = banner.image;
  element.classList.toggle('small', live.style.layout === 'corner');
  if (element.dataset.id !== banner.id) {
    element.dataset.id = banner.id;
    element.hidden = true; void element.offsetWidth;
  }
  setText('bannerText', banner.text);
  element.hidden = false;
}

// ── Graphics ────────────────────────────────────────────────────────────────
function node(className, text) {
  const element = document.createElement('div');
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function rowsBlock(graphic, teams) {
  const rows = node('gRows');
  const compare = graphic.type === 'compare';
  const add = (className, values) => {
    const row = node(className);
    values.forEach(value => { const cell = document.createElement('span'); cell.textContent = value; row.append(cell); });
    rows.append(row);
    return row;
  };
  if (compare) add('gRow columns', [teams[0].short, '', teams[1].short]);
  (graphic.rows || []).forEach(item => {
    if (compare) {
      const row = add('gRow', [item.left || '—', item.label, item.right || '—']);
      const l = parseFloat(item.left), r = parseFloat(item.right);
      if (Number.isFinite(l) && Number.isFinite(r) && l !== r) row.children[l > r ? 0 : 2].classList.add('lead');
    } else add('gRow single', [item.label, item.left || '—']);
  });
  return rows;
}

function graphicContent(graphic, teams) {
  const fragment = [];
  if (graphic.type === 'player') {
    const card = node('player');
    // No player photo: show the team's logo in the photo box instead (the number
    // then sits beside the name, same as with a photo). No logo either: big number.
    const team = teams?.[graphic.side];
    const logo = !validImage(graphic.photo) && validImage(team?.logo) ? team.logo : '';
    const hasPhoto = validImage(graphic.photo) || Boolean(logo);
    const photo = node('photo');
    if (logo) {
      const img = document.createElement('img'); img.alt = ''; img.src = logo; img.className = 'teamLogo' + (team.logoBacking ? ' backed' : ''); photo.append(img);
    } else if (hasPhoto) {
      const img = document.createElement('img'); img.alt = ''; img.src = graphic.photo; img.style.objectPosition = photoPosition(graphic.photoPos); photo.append(img);
    } else if (graphic.number) photo.append(node('num', '#' + graphic.number));
    else card.classList.add('noPhoto');
    if (hasPhoto || graphic.number) card.append(photo);
    const body = node('body');
    const who = node('who');
    if (graphic.kicker) who.append(node('gKicker', graphic.kicker));
    const line = node('line1');
    if (graphic.number && hasPhoto) line.append(node('number', '#' + graphic.number));
    line.append(node('pname', graphic.title));
    who.append(line);
    if (graphic.subtitle) who.append(node('gSub', graphic.subtitle));
    body.append(who);
    if (graphic.stat) body.append(node('stat', graphic.stat));
    if (graphic.rows?.length) body.append(rowsBlock(graphic, teams));
    card.append(body);
    fragment.push(card);
    return fragment;
  }
  const head = node('gHead');
  const text = node('gText');
  if (graphic.kicker) text.append(node('gKicker', graphic.kicker));
  text.append(node('gTitle', graphic.title));
  if (graphic.subtitle) text.append(node('gSub', graphic.subtitle));
  head.append(text);
  if (validImage(graphic.image)) {
    const img = document.createElement('img'); img.alt = ''; img.src = graphic.image;
    head.classList.add('withImage'); head.append(img);
  }
  fragment.push(head);
  if (graphic.rows?.length) fragment.push(rowsBlock(graphic, teams));
  return fragment;
}

let graphicKey = '';
function paintGraphic() {
  const {teams, style} = live;
  const graphic = previewMode ? previewGraphic : live.graphic;
  let placement = style.graphicPlacement;
  if (placement === 'auto') placement = style.layout !== 'corner' && style.position.endsWith('center') ? 'stack' : 'lower-left';
  const target = placement === 'stack' ? byId('stackGraphic') : byId('lowerGraphic');
  const other = placement === 'stack' ? byId('lowerGraphic') : byId('stackGraphic');
  other.hidden = true;
  other.dataset.key = '';
  const show = layers.has('graphic') && graphic && (!graphic.until || now() < graphic.until) && (previewMode || !covered());
  const keyNow = JSON.stringify([graphic, placement, teams.map(t => [t.short, t.color])]);
  if (!show) { target.hidden = true; target.dataset.key = ''; graphicKey = ''; return; }
  if (target.dataset.key === keyNow) return;
  target.dataset.key = keyNow;
  graphicKey = keyNow;
  if (placement !== 'stack') target.className = 'graphic ' + placement;
  const color = graphic.side >= 0 ? teams[graphic.side].color : style.accent;
  target.style.setProperty('--g', color);
  target.style.setProperty('--g-dark', shade(color, 0.55));
  target.style.setProperty('--g-mid', mix(color, '#0f1622', 0.5));
  target.style.setProperty('--left', teams[0].color);
  target.style.setProperty('--right', teams[1].color);
  target.hidden = true; void target.offsetWidth;
  target.replaceChildren(...graphicContent(graphic, teams));
  target.hidden = false;
}

// ── Full-screens ────────────────────────────────────────────────────────────
const covered = () => Boolean(live) && !previewMode && fullUp(live.full, now());
let fullKey = '';
function paintFull() {
  const element = byId('full');
  const full = previewMode ? previewFull : live.full;
  const show = layers.has('full') && full && (previewMode || fullUp(full, now()));
  if (!show) { element.hidden = true; fullKey = ''; return; }
  const keyNow = JSON.stringify([full, live.teams.map(t => [t.name, t.short, t.rank, t.record, t.color, t.accent, t.logo.length, t.logoBacking]),
    live.style.dark, live.style.accent, live.style.brandLogo?.length]);
  if (keyNow === fullKey && !element.hidden) return;
  fullKey = keyNow;
  // Under a wipe it appears at once (the wipe hides the change); otherwise it fades in.
  const t = live.transition;
  element.classList.toggle('cut', Boolean(t && Math.abs(coverAt(t) - full.showAt) < 50));
  renderFull(element, full, live);
  element.hidden = false;
  fitText(element);
}

// ── Wipes ───────────────────────────────────────────────────────────────────
let wipeId = '';
let wipeTimer = 0;
function paintWipe() {
  const t = live.transition;
  if (!layers.has('wipe') || previewMode || !t || t.id === wipeId) return;
  wipeId = t.id;
  const n = now();
  if (wipeOver(t, n)) return; // too late to show (or the page just opened)
  const element = byId('wipe');
  renderWipe(element, t, live, n);
  element.hidden = false;
  clearTimeout(wipeTimer);
  wipeTimer = setTimeout(() => { element.hidden = true; element.replaceChildren(); }, t.at + wipeMs(t.speed) + 150 - n);
}

// ── Ticker: feed the live game in when asked ────────────────────────────────
function liveForTicker() {
  const {sport, teams} = live;
  const game = live.games[sport];
  const ms = remaining(game.game, now());
  const final = /^final/i.test(game.period) || /^final/i.test(game.status);
  return {
    id: 'live', league: tickerDoc.liveLabel || 'THIS GAME', state: final ? 'post' : 'in', final, typed: true, start: null,
    teams: teams.map((t, i) => ({name: t.name, score: String(game.score[i]), logo: t.logo, color: t.color, rank: t.rank || null,
      record: t.record, keys: [t.name.toLowerCase()], winner: final && game.score[i] > game.score[1 - i]})),
    detail: final ? 'FINAL' : running(game.game, now()) ? game.period : `${game.period} ${clockText(ms, sport === 'basketball')}`,
  };
}

function paint() {
  try {
    paintWipe();
    paintBug();
    paintBanner();
    paintGraphic();
    paintFull();
    if (ticker && tickerDoc) {
      ticker.setLive(liveForTicker());
      // A corner ticker would sit on the full-screen's headline; a bottom bar stays.
      ticker.configure(covered() && tickerDoc.layout === 'corner' ? {...tickerDoc, visible: false} : tickerDoc);
    }
    tick();
  } catch (error) {
    console.error('Overlay paint failed', error);
  }
}

if (previewMode) {
  addEventListener('message', event => {
    if (event.origin !== location.origin || !event.data || !('studioPreview' in event.data)) return;
    const graphic = event.data.studioPreview;
    previewGraphic = graphic && typeof graphic === 'object' ? {...graphic, until: 0} : null;
    if (live) paintGraphic();
  });
  addEventListener('message', event => {
    if (event.origin !== location.origin || !event.data || !('studioPreviewFull' in event.data)) return;
    const full = event.data.studioPreviewFull;
    previewFull = full && typeof full === 'object' ? {...full, id: 'preview', showAt: 0, hideAt: 0} : null;
    if (live) paintFull();
  });
}

if (!key) byId('keyMissing').hidden = false;
else {
  poll();
  setInterval(poll, 800);
  setInterval(tick, 90);
  setInterval(() => { if (live) { paintBanner(); paintGraphic(); } }, 500);
}
window.studio = {get live() { return live; }, esc};
