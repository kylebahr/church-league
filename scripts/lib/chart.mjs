// Hand-rolled SVG charts. No chart library, so nothing to break, nothing to
// load, and it renders before JavaScript arrives.

import { esc, avatar } from './html.mjs';

/** Cumulative roto-point race. 17 lines is noise, so all lines sit muted and
 *  app.js spotlights one on tap; the playoff cut line is drawn on top. */
export function rotoRace({ state, weeks }) {
  const regWeeks = weeks.filter(w => w.isRegular).map(w => w.week);
  if (regWeeks.length < 2) return null;

  const series = state.standings.map(s => {
    let cum = 0;
    const pts = regWeeks.map(w => { cum += s.byWeek[w]?.roto ?? 0; return cum; });
    return { username: s.username, name: s.name, rank: s.rank, pts };
  });

  // Cut line: the Nth-best cumulative total at each week.
  const cutIdx = state.league.schedule.playoffTeams - 1;
  const cut = regWeeks.map((_, i) => {
    const col = series.map(s => s.pts[i]).sort((a, b) => b - a);
    return col[cutIdx] ?? 0;
  });

  const W = 920, H = 340, PL = 42, PR = 14, PT = 14, PB = 30;
  const maxY = Math.max(...series.map(s => s.pts[s.pts.length - 1]), ...cut) || 1;
  const x = i => PL + (regWeeks.length === 1 ? 0 : i * (W - PL - PR) / (regWeeks.length - 1));
  const y = v => PT + (H - PT - PB) * (1 - v / maxY);
  const path = pts => pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  // the same path closed down to the baseline, for the spotlighted team's fill
  const area = pts => `${path(pts)}L${x(pts.length - 1).toFixed(1)},${y(0).toFixed(1)}`
    + `L${x(0).toFixed(1)},${y(0).toFixed(1)}Z`;

  const yTicks = niceTicks(maxY, 4);
  const grid = yTicks.map(t =>
    `<line class="grid-line" x1="${PL}" x2="${W - PR}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>` +
    `<text class="axis-tx" x="${PL - 7}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end">${t}</text>`
  ).join('');
  const xLabels = regWeeks.map((w, i) =>
    (regWeeks.length <= 10 || i === 0 || i === regWeeks.length - 1 || w % 2 === 0)
      ? `<text class="axis-tx" x="${x(i).toFixed(1)}" y="${H - PB + 17}" text-anchor="middle">${w}</text>` : ''
  ).join('');

  const areas = series.map(s =>
    `<path class="area" data-team="${esc(s.username)}" d="${area(s.pts)}"/>`
  ).join('');
  const lines = series.map(s =>
    `<path class="ln${s.rank <= 3 ? ' top' : ''}" data-team="${esc(s.username)}" d="${path(s.pts)}"/>`
  ).join('');

  const legend = series.slice().sort((a, b) => a.rank - b.rank).map(s =>
    `<button type="button" data-spotlight="${esc(s.username)}">${avatar(s.username)}${esc(s.username)}</button>`
  ).join('');

  return `<div class="chart-wrap">
  <svg class="chart" viewBox="0 0 ${W} ${H}" role="img"
       aria-label="Cumulative rotisserie points by week for all ${series.length} teams">
    <defs><linearGradient id="clfade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f2711c" stop-opacity=".28"/>
      <stop offset="1" stop-color="#f2711c" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}${xLabels}
    ${areas}
    ${lines}
    <path class="ln cut" d="${path(cut)}"/>
    <g id="race-hi"></g>
  </svg>
  <p style="font-size:12px;color:var(--text-faint);margin:10px 0 0">
    Dashed orange = the playoff cut line (${state.league.schedule.playoffTeams}th place). Tap a name to follow one team.
  </p>
  <div class="legend">${legend}</div>
</div>`;
}

/** Horizontal bars, used for points-for and ownership. */
export function barList(items, { fmt = v => v, max = null } = {}) {
  const m = max ?? Math.max(...items.map(i => i.value), 1);
  return `<div style="display:grid;gap:9px">${items.map(i => `
    <div>
      <div style="display:flex;gap:8px;font-size:12.5px;margin-bottom:4px">
        <span style="font-weight:700">${esc(i.label)}</span>
        ${i.sub ? `<span style="color:var(--text-faint)">${esc(i.sub)}</span>` : ''}
        <span style="margin-left:auto;font-weight:800;font-variant-numeric:tabular-nums">${fmt(i.value)}</span>
      </div>
      <div class="bar"><i style="width:${(100 * i.value / m).toFixed(1)}%${i.color ? `;background:${i.color}` : ''}"></i></div>
    </div>`).join('')}</div>`;
}

function niceTicks(max, count) {
  const step = Math.max(1, Math.ceil(max / count / 5) * 5);
  const out = [];
  for (let v = 0; v <= max; v += step) out.push(v);
  if (out[out.length - 1] !== max) out.push(Math.ceil(max / step) * step);
  return [...new Set(out)];
}
