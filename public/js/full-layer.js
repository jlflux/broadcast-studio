// Draws a full-screen graphic (from live.full) and the branded wipe (from
// live.transition) on the 1920×1080 overlay canvas. All text goes in with
// textContent; images are checked with validImage.
import {mix, photoPosition, readable, shade, validImage} from './common.js';
import {wipeMs} from './transitions.js';

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = text;
  return element;
}
function picture(src, className = '') {
  const image = el('img', className);
  image.alt = '';
  image.src = src;
  return image;
}
function logo(team, className = '') {
  const box = el('div', 'fsLogo ' + className);
  if (validImage(team?.logo)) box.append(picture(team.logo, team.logoBacking ? 'backed' : ''));
  else box.append(el('span', 'fsShort', team?.short || ''));
  return box;
}
const teamLabel = team => [team.rank && team.rank.trim() ? `#${team.rank.replace('#', '')}` : '', team.name].filter(Boolean).join(' ');

// Colors every full-screen and wipe can use.
export function paletteVars(element, live, side) {
  const {teams, style} = live;
  const dark = style.dark || '#101722';
  const color = side >= 0 ? teams[side].color : style.accent;
  const vars = {
    '--dark': dark, '--dark2': shade(dark, 0.55), '--studio': style.accent,
    '--g': color, '--g-dark': shade(color, 0.55), '--g-ink': readable(color), '--g-soft': mix(color, dark, 0.7),
    '--g-acc': side >= 0 ? teams[side].accent : mix(style.accent, '#ffffff', 0.35),
  };
  ['l', 'r'].forEach((key, i) => {
    const c = teams[i].color;
    Object.assign(vars, {[`--${key}`]: c, [`--${key}-dark`]: shade(c, 0.55), [`--${key}-ink`]: readable(c), [`--${key}-soft`]: mix(c, dark, 0.62), [`--${key}-acc`]: teams[i].accent});
  });
  for (const [name, value] of Object.entries(vars)) element.style.setProperty(name, value);
}

const band = side => el('div', side >= 0 ? 'fsBand' : 'fsBand both');

function head(full, team) {
  const box = el('header', 'fsHead');
  if (team) box.append(logo(team, 'headLogo'));
  const text = el('div', 'fsHeadText');
  if (full.kicker) text.append(el('div', 'fsKicker', full.kicker));
  text.append(el('div', 'fsTitle', full.title || ''));
  text.lastChild.dataset.fit = '';
  box.append(text);
  return box;
}

function foot(full, live) {
  const bar = el('footer', 'fsFoot');
  bar.append(el('span', 'fsSub', full.subtitle || ''));
  if (validImage(live.style.brandLogo)) bar.append(picture(live.style.brandLogo, 'fsBrand'));
  return bar;
}

function matchup(root, full, live) {
  const [a, b] = live.teams;
  root.append(el('div', 'mHalf left'), el('div', 'mHalf right'));
  const header = el('header', 'mHead');
  if (full.kicker) header.append(el('div', 'fsKicker', full.kicker));
  if (full.title) header.append(el('div', 'mTitle', full.title));
  root.append(header);
  [a, b].forEach((team, i) => {
    const box = el('div', `mTeam ${i ? 'right' : 'left'}`);
    box.append(logo(team, 'mLogo'));
    const name = el('div', 'mName', teamLabel(team));
    name.dataset.fit = '';
    box.append(name);
    if (team.record) box.append(el('div', 'mRecord', team.record));
    root.append(box);
  });
  root.append(el('div', 'mVs', 'VS'));
}

function lineup(root, full, live) {
  const team = live.teams[full.side];
  root.append(band(full.side), head({...full, kicker: full.kicker || team.name}, team));
  const players = full.players || [];
  if (!players.length) { root.append(el('div', 'fsEmpty', 'Pick players for the lineup')); return; }
  if (players.length <= 5) {
    const cards = el('div', 'luCards');
    cards.style.setProperty('--n', players.length);
    players.forEach(p => {
      const card = el('div', 'luCard');
      const shot = el('div', 'luPhoto');
      if (validImage(p.photo)) {
        const image = picture(p.photo);
        image.style.objectPosition = photoPosition(p.photoPos);
        shot.append(image);
      } else {
        if (validImage(team.logo)) shot.append(picture(team.logo, 'luMark'));
        shot.append(el('span', 'luBigNum', p.num ? '#' + p.num : ''));
      }
      if (p.num && validImage(p.photo)) shot.append(el('span', 'luNum', p.num));
      card.append(shot);
      const info = el('div', 'luInfo');
      const parts = p.name.trim().split(/\s+/);
      const last = parts.length > 1 ? parts.pop() : parts[0];
      info.append(el('div', 'luFirst', parts.length && parts[0] !== last ? parts.join(' ') : ''));
      const lastName = el('div', 'luLast', last);
      lastName.dataset.fit = '';
      info.append(lastName);
      info.append(el('div', 'luMeta', [p.pos, p.cls].filter(Boolean).join(' · ')));
      card.append(info);
      cards.append(card);
    });
    root.append(cards);
    return;
  }
  const list = el('div', 'luList');
  list.style.setProperty('--rows', Math.ceil(players.length / 2));
  players.forEach(p => {
    const row = el('div', 'luRow');
    row.append(el('span', 'luRowNum', p.num), el('span', 'luRowName', p.name), el('span', 'luRowMeta', [p.pos, p.cls].filter(Boolean).join(' · ')));
    row.children[1].dataset.fit = '';
    list.append(row);
  });
  root.append(list);
}

function keys(root, full, live) {
  const team = full.side >= 0 ? live.teams[full.side] : null;
  root.append(band(full.side), head({...full, kicker: full.kicker || team?.name || ''}, null));
  const list = el('ol', 'kList');
  (full.points || []).forEach((point, i) => {
    const item = el('li', 'kItem');
    item.append(el('span', 'kNum', String(i + 1)), el('span', 'kText', point));
    list.append(item);
  });
  if (!full.points?.length) list.append(el('li', 'fsEmpty', 'Type up to five keys'));
  list.style.setProperty('--n', Math.max(1, full.points?.length || 1));
  root.append(list);
  const mark = el('div', 'kMark');
  if (team) mark.append(logo(team, 'kLogo'));
  else if (validImage(live.style.brandLogo)) mark.append(picture(live.style.brandLogo, 'kBrand'));
  else mark.append(logo(live.teams[0], 'kLogo small'), el('span', 'kVs', 'VS'), logo(live.teams[1], 'kLogo small'));
  root.append(mark);
}

function scoreTop(full, live) {
  const top = el('div', 'sTop');
  live.teams.forEach((team, i) => {
    const box = el('div', `sTeam ${i ? 'right' : 'left'}`);
    const name = el('div', 'sName');
    const label = el('div', 'sTeamName', teamLabel(team));
    label.dataset.fit = '';
    name.append(label);
    if (team.record) name.append(el('div', 'sRecord', team.record));
    const score = el('div', 'sScore', String(full.score?.[i] ?? ''));
    box.append(logo(team, 'sLogo'), name, score);
    if (full.score && full.score[i] > full.score[1 - i] && /final/i.test(full.kicker || full.period || '')) box.classList.add('won');
    top.append(box);
    if (i === 0) {
      const mid = el('div', 'sMid');
      mid.append(el('div', 'sKicker', full.kicker || full.period || ''));
      top.append(mid);
    }
  });
  return top;
}

function stats(root, full, live) {
  root.append(scoreTop(full, live));
  const body = el('div', full.line ? 'sBody withLine' : 'sBody');
  if (full.line) {
    const table = el('table', 'sLine');
    const headRow = el('tr');
    headRow.append(el('th', '', ''), ...full.line.columns.map(c => el('th', '', c)), el('th', 'total', 'T'));
    table.append(headRow);
    full.line.rows.forEach((row, i) => {
      const tr = el('tr', i ? 'r' : 'l');
      tr.append(el('td', 'team', live.teams[i].short), ...row.map(n => el('td', '', String(n))), el('td', 'total', String(full.score?.[i] ?? row.reduce((s, n) => s + n, 0))));
      table.append(tr);
    });
    body.append(table);
  }
  if (full.rows?.length) {
    const rows = el('div', 'sRows');
    rows.append(el('div', 'sRowsTitle', full.title || 'Team Stats'));
    full.rows.forEach(item => {
      const row = el('div', 'sRow');
      const left = el('span', 'v l', item.left || '—');
      const right = el('span', 'v r', item.right || '—');
      const l = parseFloat(item.left), r = parseFloat(item.right);
      // Lower is better for turnovers; otherwise the bigger number leads.
      const lowWins = /turnover/i.test(item.label);
      if (Number.isFinite(l) && Number.isFinite(r) && l !== r) ((l > r) !== lowWins ? left : right).classList.add('lead');
      row.append(left, el('span', 'k', item.label), right);
      rows.append(row);
    });
    body.append(rows);
  }
  root.append(body);
}

function leaders(root, full, live) {
  root.append(band(-1), head(full, null));
  const teams = el('div', 'ldTeams');
  live.teams.forEach((team, i) => {
    const box = el('div', `ldTeam ${i ? 'right' : 'left'}`);
    box.append(logo(team, 'ldLogo'), el('span', '', team.name));
    teams.append(box);
    if (i === 0) teams.append(el('span'));
  });
  root.append(teams);
  const rows = el('div', 'ldRows');
  (full.leaders || []).forEach(item => {
    const row = el('div', 'ldRow');
    [item.left, item.right].forEach((who, i) => {
      const cell = el('div', `ldWho ${i ? 'right' : 'left'}`);
      if (!who) { cell.append(el('span', 'ldNone', '—')); cell.classList.add('none'); }
      else {
        const text = el('div', 'ldText');
        const name = el('div', 'ldName', `${who.num ? '#' + who.num + ' ' : ''}${who.name}`);
        name.dataset.fit = '';
        text.append(name, el('div', 'ldDetail', who.detail || ''));
        cell.append(text, el('div', 'ldStat', who.stat));
      }
      row.append(cell);
      if (i === 0) {
        const mid = el('div', 'ldCat');
        mid.append(el('span', '', item.label));
        if (item.unit) mid.append(el('small', '', item.unit));
        row.append(mid);
      }
    });
    rows.append(row);
  });
  if (!full.leaders?.length) rows.append(el('div', 'fsEmpty', 'Leaders show up once plays are logged'));
  root.append(rows);
}

const KINDS = {matchup, lineup, keys, stats, leaders};

export function renderFull(root, full, live) {
  root.replaceChildren();
  root.className = `fs ${full.kind}`;
  paletteVars(root, live, full.kind === 'lineup' || full.kind === 'keys' ? full.side : -1);
  const two = ['matchup', 'stats', 'leaders'].includes(full.kind);
  root.append(el('div', two ? 'fsBg two' : 'fsBg'));
  (KINDS[full.kind] || keys)(root, full, live);
  root.append(foot(full, live));
}

// Shrink text marked data-fit until it fits its box (down to 55%).
export function fitText(root) {
  root.querySelectorAll('[data-fit]').forEach(node => {
    node.style.fontSize = '';
    const base = parseFloat(getComputedStyle(node).fontSize);
    let size = base;
    while (node.scrollWidth > node.clientWidth + 1 && size > base * 0.55) {
      size -= 2;
      node.style.fontSize = size + 'px';
    }
  });
}

// ── Wipe ────────────────────────────────────────────────────────────────────
export function renderWipe(root, transition, live, now) {
  const side = transition.side;
  const team = side >= 0 ? live.teams[side] : null;
  root.replaceChildren();
  root.className = `wipe ${transition.style}`;
  paletteVars(root, live, side);
  if (side < 0) { // studio wipe: dark panels with the accent, so the brand logo reads
    const dark = live.style.dark || '#101722';
    root.style.setProperty('--g', mix(dark, '#ffffff', 0.14));
    root.style.setProperty('--g-dark', shade(dark, 0.7));
  }
  root.style.setProperty('--d', wipeMs(transition.speed) + 'ms');
  root.style.setProperty('--t0', (transition.at - now) + 'ms');
  const count = transition.style === 'stripes' ? 6 : transition.style === 'iris' ? 2 : 3;
  const holder = el('div', 'wPanels');
  for (let i = 0; i < count; i += 1) {
    const panel = el('div', 'wp');
    panel.style.setProperty('--i', i);
    holder.append(panel);
  }
  root.append(holder);
  const mark = el('div', 'wLogo');
  if (team) mark.append(logo(team));
  else if (validImage(live.style.brandLogo)) mark.append(picture(live.style.brandLogo, 'wBrand'));
  else mark.append(logo(live.teams[0], 'pair'), logo(live.teams[1], 'pair'));
  root.append(mark);
}
