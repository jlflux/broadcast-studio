// Layout math for printed spotting boards: sorting, offense/defense groups,
// and how many columns of boxes fit a page.

export const PAPER = {letter: {w: 11, h: 8.5, label: 'Letter (8.5 × 11)'}, tabloid: {w: 17, h: 11, label: 'Tabloid (11 × 17)'}};

const numberOf = p => { const n = parseInt(p.num, 10); return Number.isFinite(n) ? n : 1000; };
export const byNumber = players => [...players].sort((a, b) => numberOf(a) - numberOf(b) || String(a.name).localeCompare(String(b.name)));

// Football positions in the order a spotter reads them.
const OFFENSE = ['QB', 'RB', 'HB', 'TB', 'FB', 'WR', 'SE', 'FL', 'SB', 'SL', 'X', 'Z', 'TE', 'Y', 'OL', 'OT', 'LT', 'OG', 'LG', 'C', 'OC', 'RG', 'RT', 'T', 'G'];
const DEFENSE = ['DL', 'DE', 'EDGE', 'DT', 'NT', 'NG', 'LB', 'ILB', 'MLB', 'MIKE', 'OLB', 'WLB', 'WILL', 'SLB', 'SAM', 'DB', 'CB', 'NB', 'S', 'FS', 'SS', 'ROV'];
const SPECIAL = ['K', 'PK', 'P', 'LS', 'KR', 'PR'];
const tokens = pos => String(pos || '').toUpperCase().split(/[\s/,|&+-]+/).filter(Boolean);

// Two-way players appear in both groups (common in high school). Players with
// no position we know go in "other" next to the specialists.
export function footballGroups(players) {
  const groups = {offense: [], defense: [], special: [], other: []};
  for (const p of players) {
    const t = tokens(p.pos);
    let placed = false;
    for (const [name, list] of [['offense', OFFENSE], ['defense', DEFENSE], ['special', SPECIAL]]) {
      const hit = t.map(token => list.indexOf(token)).filter(i => i >= 0);
      if (hit.length) { groups[name].push({p, rank: Math.min(...hit)}); placed = true; }
    }
    if (!placed) groups.other.push({p, rank: 0});
  }
  const sorted = list => list.sort((a, b) => a.rank - b.rank || numberOf(a.p) - numberOf(b.p)).map(x => x.p);
  return {offense: sorted(groups.offense), defense: sorted(groups.defense), special: sorted(groups.special), other: byNumber(groups.other.map(x => x.p))};
}

// Columns × rows for `count` boxes in a w × h (inches) area. Boxes read best
// about three times wider than tall; rows never get shorter than minHeight.
export function gridShape(count, w, h, {ratio = 3.1, minHeight = 0.42, maxHeight = 1.2, maxCols = 8, minWidth = 1.55} = {}) {
  if (!count) return {cols: 1, rows: 1, boxW: w, boxH: Math.min(h, maxHeight)};
  let best = null;
  for (let cols = 1; cols <= maxCols; cols += 1) {
    const rows = Math.ceil(count / cols);
    const boxW = w / cols;
    const boxH = Math.min(h / rows, maxHeight);
    // Too short is worse than too narrow; both only when nothing else fits.
    const penalty = (h / rows >= minHeight ? 0 : 10 + minHeight / (h / rows)) + (cols === 1 || boxW >= minWidth ? 0 : 5 + minWidth / boxW);
    const score = Math.abs(Math.log(boxW / boxH / ratio)) + penalty + (rows * cols - count) * 0.01;
    if (!best || score < best.score) best = {cols, rows, boxW, boxH, score};
  }
  const {cols, rows, boxW, boxH} = best;
  return {cols, rows, boxW, boxH};
}

// "Jaylen Carter" → {first: 'Jaylen', last: 'Carter'}; "Carter, Jaylen" works too.
export function splitName(name) {
  const text = String(name || '').trim();
  if (text.includes(',')) {
    const [last, first] = text.split(',').map(s => s.trim());
    return {first: first || '', last: last || ''};
  }
  const parts = text.split(/\s+/);
  const suffix = parts.length > 2 && /^(jr\.?|sr\.?|ii|iii|iv)$/i.test(parts.at(-1)) ? parts.pop() : '';
  const last = parts.pop() || '';
  return {first: parts.join(' '), last: suffix ? `${last} ${suffix}` : last};
}
