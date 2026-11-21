// Box score and play-by-play views, shared by the stat keeper page and the
// control panel's Box score & plays tab.
import {$$, clockText, esc} from './common.js';
import {boxScore, compareRows, describe, lineScore, points} from './stats-engine.js';

// Per-team stat tables for a sport (also used for the CSV export).
export function tables(sport, box) {
  const out = [];
  const name = p => `${p.player.num ? '#' + p.player.num + ' ' : ''}${p.player.name}`;
  box.teams.forEach((team, t) => {
    const blocks = [];
    if (sport === 'basketball') {
      const rows = team.players.filter(p => Object.values(p.line).some(Boolean)).map(p => {
        const l = p.line;
        return {p, cells: [name(p), l.pts, `${l.fgm}-${l.fga}`, `${l.tpm}-${l.tpa}`, `${l.ftm}-${l.fta}`, l.oreb, l.dreb, l.oreb + l.dreb, l.ast, l.stl, l.blk, l.to, l.pf]};
      });
      const l = team.line;
      rows.push({cells: ['TEAM', l.pts, `${l.fgm}-${l.fga}`, `${l.tpm}-${l.tpa}`, `${l.ftm}-${l.fta}`, l.oreb, l.dreb, l.oreb + l.dreb, l.ast, l.stl, l.blk, l.to, l.pf], total: true});
      blocks.push({title: 'Box score', columns: ['Player', 'PTS', 'FG', '3PT', 'FT', 'OREB', 'DREB', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PF'], rows});
    } else {
      const section = (title, columns, has, cells) => {
        const rows = team.players.filter(p => has(p.line)).map(p => ({p, cells: [name(p), ...cells(p.line)]}));
        if (rows.length) blocks.push({title, columns: ['Player', ...columns], rows});
      };
      section('Passing', ['C/ATT', 'YDS', 'TD', 'INT', 'LONG'], l => l.pass.att, l => [`${l.pass.cmp}/${l.pass.att}`, l.pass.yds, l.pass.td, l.pass.int, l.pass.long]);
      section('Rushing', ['CAR', 'YDS', 'AVG', 'TD', 'LONG'], l => l.rush.car, l => [l.rush.car, l.rush.yds, (l.rush.yds / l.rush.car).toFixed(1), l.rush.td, l.rush.long]);
      section('Receiving', ['REC', 'YDS', 'TD', 'LONG'], l => l.rec.rec, l => [l.rec.rec, l.rec.yds, l.rec.td, l.rec.long]);
      section('Defense', ['TKL', 'SACK', 'INT', 'FR'], l => l.def.tkl || l.def.sack || l.def.int || l.def.fr, l => [l.def.tkl, l.def.sack, l.def.int, l.def.fr]);
      section('Kicking', ['FG', 'LONG', 'XP'], l => l.kick.fga || l.kick.xpa, l => [`${l.kick.fgm}/${l.kick.fga}`, l.kick.long, `${l.kick.xpm}/${l.kick.xpa}`]);
      section('Punting', ['NO', 'YDS', 'AVG', 'LONG'], l => l.punt.no, l => [l.punt.no, l.punt.yds, (l.punt.yds / l.punt.no).toFixed(1), l.punt.long]);
      section('Returns', ['NO', 'YDS', 'TD'], l => l.ret.no, l => [l.ret.no, l.ret.yds, l.ret.td]);
    }
    out.push({team: t, blocks});
  });
  return out;
}

// teams: {name(i), short(i), color(i)}. onAir(team, playerId) adds "On air" buttons.
export function renderBoxScore(container, stats, teams, onAir) {
  const sport = stats.sport;
  const box = boxScore(sport, stats);
  const lines = lineScore(sport, stats.events);
  const compare = compareRows(sport, box);
  const table = (columns, rows, withAir) => `<div class="scroll"><table><thead><tr>${columns.map((c, i) => `<th class="${i ? 'n' : ''}">${esc(c)}</th>`).join('')}${withAir ? '<th></th>' : ''}</tr></thead><tbody>${rows.map(r =>
    `<tr ${r.total ? 'style="font-weight:700"' : ''}>${r.cells.map((c, i) => `<td class="${i ? 'n' : ''}">${esc(c)}</td>`).join('')}${withAir ? `<td>${r.p ? `<button type="button" class="airBtn" data-air="${esc(r.p.player.id)}">On air</button>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
  let html = `<section class="card"><header><h2>Line score</h2></header>${table(['Team', ...lines.columns, 'T'], [0, 1].map(t => ({cells: [teams.name(t), ...lines.rows[t], box.totals[t]]})))}</section>
    <section class="card"><header><h2>Team stats</h2></header>${table(['', teams.short(0), teams.short(1)], compare.map(r => ({cells: [r.label, r.left, r.right]})))}</section>`;
  for (const {team, blocks} of tables(sport, box)) {
    html += `<section class="card boxTeam" data-team="${team}"><h3>${esc(teams.name(team))}</h3>${blocks.length ? blocks.map(b => `<span class="label">${esc(b.title)}</span>${table(b.columns, b.rows, Boolean(onAir))}`).join('') : '<p class="muted">No stats yet.</p>'}</section>`;
  }
  container.innerHTML = html;
  if (onAir) {
    $$('.boxTeam', container).forEach(section => {
      const team = Number(section.dataset.team);
      $$('[data-air]', section).forEach(b => { b.onclick = () => onAir(team, b.dataset.air, box); });
    });
  }
}

export function boxCsv(stats, teams) {
  const sport = stats.sport;
  const csv = value => /[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value);
  const lines = [];
  for (const {team, blocks} of tables(sport, boxScore(sport, stats))) {
    for (const block of blocks) {
      lines.push([teams.name(team), block.title].map(csv).join(','));
      lines.push(block.columns.map(csv).join(','));
      block.rows.forEach(r => lines.push(r.cells.map(csv).join(',')));
      lines.push('');
    }
  }
  return lines.join('\n');
}

// Newest first. onDelete(playId) adds a delete button to each play.
export function renderPlays(container, stats, teams, onDelete) {
  const sport = stats.sport;
  const events = [...stats.events].reverse();
  if (!events.length) { container.innerHTML = '<p class="muted">No plays yet.</p>'; return; }
  container.innerHTML = events.map(e => {
    const pts = points(sport, e);
    return `<div class="pbpRow"><span class="t">${esc(e.period || '')}${e.clock != null ? ' ' + clockText(e.clock, sport === 'basketball') : ''}</span><span><span class="swatch" style="--c:${esc(teams.color(e.team))}"></span>${esc(teams.short(e.team))}${pts ? ` <span class="pts">+${pts}</span>` : ''}</span>
      <span>${esc(describe(sport, e, stats))}</span><button type="button" class="ghost" data-del="${esc(e.id)}" aria-label="Delete play">✕</button></div>`;
  }).join('');
  $$('[data-del]', container).forEach(b => { b.onclick = () => onDelete(b.dataset.del); });
}
