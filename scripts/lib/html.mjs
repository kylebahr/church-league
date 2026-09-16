// Shared HTML layout + components. Everything renders server-side so the site
// is instant on a phone and needs no JavaScript to read.

export const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const money = n => {
  const v = Number(n) || 0;
  const s = Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: Math.abs(v) % 1 ? 2 : 0, maximumFractionDigits: 2,
  });
  return (v < 0 ? '-$' : '$') + s;
};
export const moneyCell = n => {
  const v = Number(n) || 0;
  const cls = v > 0 ? 'money-pos' : v < 0 ? 'money-neg' : 'money-zero';
  return `<span class="${cls}">${v > 0 ? '+' : ''}${money(v)}</span>`;
};
export const num = (n, d = 2) => n === null || n === undefined
  ? '<span style="color:var(--sheet-dim)">&mdash;</span>'
  : Number(n).toFixed(d).replace(/\.00$/, '');

const NAV = [
  ['index.html', 'Standings'],
  ['weeks.html', 'Weeks'],
  ['money.html', 'Money'],
  ['players.html', 'Players'],
];

export function layout({ title, page, league, body, state, extraHead = '' }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#16181a">
<title>${esc(title)} &middot; ${esc(league.leagueName)}</title>
<meta name="description" content="${esc(league.leagueName)} ${esc(league.seasonLabel)} - rotisserie standings, winnings and weekly results.">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23f2711c'/%3E%3Ctext x='16' y='23' font-family='Helvetica,Arial' font-size='18' font-weight='bold' fill='%23fff' text-anchor='middle'%3ECL%3C/text%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">
<link rel="stylesheet" href="assets/app.css">
${extraHead}
</head>
<body data-page="${esc(page)}">
<header class="topbar"><div class="topbar-in">
  <a class="brand" href="index.html" style="text-decoration:none;color:inherit">
    <span class="brand-mark">CL</span>
    <span class="brand-txt"><b>${esc(league.leagueName)}</b><span>${esc(league.seasonLabel)}</span></span>
  </a>
  <nav class="nav">
    ${NAV.map(([href, label]) =>
      `<a href="${href}"${page === href ? ' aria-current="page"' : ''}>${label}</a>`).join('\n    ')}
    <a href="${esc(league.links.leagueHome)}" target="_blank" rel="noopener">DK League &#8599;</a>
  </nav>
</div></header>
<main class="wrap">
${body}
</main>
<footer class="ft"><div class="wrap">
  <p>${esc(league.leagueName)} &middot; ${esc(league.seasonLabel)} &middot; rotisserie scoring, ${state.league.members.length} teams, ${money(state.payouts.poolTotal)} pool.
  Commissioner: ${esc(league.commissioner.name)} (<a href="mailto:${esc(league.commissioner.email)}">${esc(league.commissioner.email)}</a>).</p>
  <p>Built from the DraftKings contest exports. Last updated <span data-utc="${state.generatedAt}">${new Date(state.generatedAt).toUTCString()}</span>.
  Scoring verified bit-identical to the retired league spreadsheet.</p>
</div></footer>
<script src="assets/app.js"></script>
</body>
</html>`;
}

export function hero({ title, sub, buttons = [] }) {
  return `<section class="hero">
  <h1>${title}</h1>
  ${sub ? `<p class="sub">${sub}</p>` : ''}
  ${buttons.length ? `<div class="btn-row" style="margin-top:14px">${buttons.join('')}</div>` : ''}
</section>`;
}

export const stat = ({ k, v, m, tone }) => `<div class="stat${tone ? ` is-${tone}` : ''}">
  <div class="k">${k}</div><div class="v">${v}</div>${m ? `<div class="m">${m}</div>` : ''}
</div>`;

export const stats = items => `<div class="stats">${items.join('')}</div>`;

export const strip = items => `<div class="strip">${items
  .map(([k, v]) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}</div>`;

export const panel = ({ title, note, body, flush = false, head = '' }) => `<section class="panel">
  ${title ? `<div class="panel-head"><h2>${title}</h2>${head}${note ? `<span class="note">${note}</span>` : ''}</div>` : ''}
  <div class="panel-body${flush ? ' flush' : ''}">${body}</div>
</section>`;

export const sheet = (inner, sticky = false) =>
  `<div class="sheet${sticky ? ' sticky-1' : ''}">${inner}</div>`;

export const movementCell = m => m === null || m === 0
  ? '<span class="mv mv-flat">&ndash;</span>'
  : m > 0 ? `<span class="mv mv-up">&#9650;${m}</span>` : `<span class="mv mv-down">&#9660;${Math.abs(m)}</span>`;

export const whoami = members => `<div class="whoami">
  <label for="whoami">Spotlight your team</label>
  <select id="whoami"><option value="">Nobody</option>
    ${members.map(m => `<option value="${esc(m.username)}">${esc(m.username)}${m.name ? ` &mdash; ${esc(m.name)}` : ''}</option>`).join('')}
  </select>
  <span id="whoami-note" style="color:var(--text-faint)"></span>
</div>`;

export const empty = (title, msg) =>
  `<div class="empty"><b>${title}</b>${msg ? `<span>${msg}</span>` : ''}</div>`;

/** Over/underperformance marker, DK's fire/snowflake convention. */
export const perfMark = (fpts, threshold = 20) => fpts >= threshold
  ? '<span class="hot" title="big week">&#128293;</span>'
  : fpts <= 5 ? '<span class="cold" title="cold">&#10052;&#65039;</span>' : '';
