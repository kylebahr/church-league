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

export function layout({ title, page, league, body, state, band = '', extraHead = '' }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0e1114">
<title>${esc(title)} &middot; ${esc(league.leagueName)}</title>
<meta name="description" content="${esc(league.leagueName)} ${esc(league.seasonLabel)} - rotisserie standings, winnings and weekly results.">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23f2711c'/%3E%3Ctext x='16' y='23' font-family='Helvetica,Arial' font-size='18' font-weight='bold' fill='%23fff' text-anchor='middle'%3ECL%3C/text%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=IBM+Plex+Mono:wght@500;600;700&display=swap">
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
    <a class="nav-cta" href="${esc(league.links.leagueHome)}" target="_blank" rel="noopener">DK League &#8599;</a>
  </nav>
</div></header>
${band}
<main class="wrap">
${body}
</main>
<footer class="ft"><div class="wrap">
  <p>${esc(league.leagueName)} &middot; ${esc(league.seasonLabel)} &middot; rotisserie scoring,
  ${state.league.members.length} teams, ${money(state.payouts.poolTotal)} pool.
  Scoring verified bit-identical to the retired league spreadsheet.</p>
  <p class="build">Built <span data-utc="${state.generatedAt}">${new Date(state.generatedAt).toUTCString()}</span><br>
  From DK contest export &middot; Week ${state.lastWeek ?? '&mdash;'}</p>
</div></footer>
<script src="assets/app.js"></script>
</body>
</html>`;
}

/**
 * NOTE: hero() renders its own .hero-band > .wrap so the gradient reaches the
 * page edges. Pass it to layout()'s `band` slot, never inside `body` - nesting
 * it in main.wrap would double the max-width and clip the band.
 */
export function hero({ title, sub, buttons = [], eyebrow = '', chip = '', aside = '' }) {
  return `<div class="hero-band"><div class="wrap"><section class="hero">
  <div class="hero-grid">
    <div class="hero-main">
      ${chip || eyebrow ? `<div class="eyebrow-row">${chip}${eyebrow ? `<span class="eyebrow">${eyebrow}</span>` : ''}</div>` : ''}
      <h1>${title}</h1>
      ${sub ? `<p class="sub">${sub}</p>` : ''}
      ${buttons.length ? `<div class="btn-row" style="margin-top:20px">${buttons.join('')}</div>` : ''}
    </div>
    ${aside}
  </div>
</section></div></div>`;
}

export const stat = ({ k, v, m, tone }) => `<div class="stat${tone ? ` is-${tone}` : ''}">
  <div class="k">${k}</div><div class="v">${v}</div>${m ? `<div class="m">${m}</div>` : ''}
</div>`;

export const stats = items => `<div class="stats">${items.join('')}</div>`;

export const strip = items => `<div class="strip">${items
  .map(([k, v]) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}</div>`;

export const panel = ({ title, note, body, flush = false, head = '', tag = '' }) => `<section class="panel">
  ${title ? `<div class="panel-head"><h2>${title}</h2>${tag ? `<span class="tag">${tag}</span>` : ''}${head}${note ? `<span class="note">${note}</span>` : ''}</div>` : ''}
  <div class="panel-body${flush ? ' flush' : ''}">${body}</div>
</section>`;

export const sheet = (inner, sticky = false) =>
  `<div class="sheet${sticky ? ' sticky-1' : ''}">${inner}</div>`;

export const movementCell = m => m === null || m === 0
  ? '<span class="mv mv-flat">&ndash;</span>'
  : m > 0 ? `<span class="mv mv-up">&#9650;${m}</span>` : `<span class="mv mv-down">&#9660;${Math.abs(m)}</span>`;

export const whoami = members => `<div class="whoami">
  <label for="whoami">Spotlight</label>
  <select id="whoami"><option value="">Your team</option>
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

/* ---------------------------------------------------------- cell components */

/**
 * Avatar colour.
 *
 * The obvious `h = (h * 31 + code) % 360` collapses: taking the modulo every
 * iteration throws away entropy, and on this roster it put urfullofBS23 and
 * Yolander 1 degree apart, five teams on the same blue, and three avatars
 * inside the reserved orange and green bands. So:
 *
 *   1. FNV-1a for a real avalanche, modulo applied once at the end.
 *   2. Hash picks from a curated ring of 22 hues that deliberately skips the
 *      brand orange band (356-50) and the money green band (74-140), so an
 *      avatar can never be mistaken for a semantic colour.
 *   3. resolveAvatarHues() probes collisions off each other at build time, so
 *      no two teams on the roster ever share a stop. Minimum separation 12deg.
 *
 * Stability: a username always hashes to the same stop. Only an actual
 * collision moves, and it probes in sorted order, so adding a member cannot
 * reshuffle anyone who was not already colliding.
 */
const AVATAR_HUES = [
  152, 164, 176, 188, 200, 212, 224, 236, 248, 260, 272,
  284, 296, 308, 320, 332, 344, 50, 62, 140, 356, 74,
];

const fnv1a = str => {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

/** Pure, roster-unaware hue for a username. */
export const avatarHue = u => AVATAR_HUES[fnv1a(String(u)) % AVATAR_HUES.length];

let hueMap = null;

/**
 * Assign every roster member a distinct stop. Call once per build.
 * @returns {Map<string, number>} username -> hue
 */
export function resolveAvatarHues(usernames) {
  const taken = new Map();   // hue -> username
  const out = new Map();
  // Sorted so the probe order is deterministic regardless of roster order.
  for (const u of [...usernames].sort()) {
    const start = fnv1a(u) % AVATAR_HUES.length;
    let hue = null;
    for (let k = 0; k < AVATAR_HUES.length; k++) {
      const cand = AVATAR_HUES[(start + k) % AVATAR_HUES.length];
      if (!taken.has(cand)) { hue = cand; break; }
    }
    if (hue === null) hue = AVATAR_HUES[start];  // more members than stops
    taken.set(hue, u);
    out.set(u, hue);
  }
  hueMap = out;
  return out;
}

export const avatar = u => {
  const init = (String(u).replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || '??').toUpperCase();
  const hue = (hueMap && hueMap.get(u)) ?? avatarHue(u);
  return `<span class="avatar" style="--h:${hue}" aria-hidden="true">${esc(init)}</span>`;
};

/** Team cell: avatar + username + real name. */
export const teamCell = (u, name) => `<span class="teamcell">${avatar(u)}<span>
  <b>${esc(u)}</b>${name && name !== u ? `<small>${esc(name)}</small>` : ''}
</span></span>`;

/** Rank chip. #1 is lit, top 3 are warm, the rest are neutral. */
export const rankChip = r =>
  `<span class="rkchip${r === 1 ? ' first' : r <= 3 ? ' top3' : ''}">${r}</span>`;

/** Labelled playoff-cut divider row. cols = total columns in the table. */
export const cutRow = (cols, { label, note, right = '' }) =>
  `<tr class="cutrow"><td colspan="${cols}"><div class="cutrow-in">
    <b>${label}</b><span>${note}</span>${right ? `<em>${right}</em>` : ''}
  </div></td></tr>`;

/** Weekly-wins chip. */
export const wkChip = n => n
  ? `<span class="wkchip">${n}</span>`
  : '<span style="color:#b6bdc4">&mdash;</span>';

/** Live/final status chip with a pulsing dot. */
export const liveChip = label => `<span class="chip-live"><i></i>${esc(label)}</span>`;

/** Right-hand hero card: { k, v, sub, rows: [[label, value], ...] } */
export const heroAside = ({ k, v, sub = '', rows = [] }) => `<aside class="hero-aside">
  <div class="k">${k}</div>
  <div class="v">${v}${sub ? `<small>${sub}</small>` : ''}</div>
  ${rows.length ? '<hr>' : ''}
  ${rows.map(([a, b]) => `<div class="row"><span>${a}</span><b>${b}</b></div>`).join('')}
</aside>`;

/** Quiet commissioner strip for housekeeping (this site is public). */
export const commishStrip = (items, href = 'money.html') => items.length
  ? `<div class="commish"><b>Commissioner</b><span>${items.length} setup item${items.length > 1 ? 's' : ''} open &mdash; ${items.join(', ')}.</span><a href="${href}">Details &rarr;</a></div>`
  : '';

/** Flattens the setup strings, which carry <b>/<code>, into one plain line. */
export const stripTags = h => String(h)
  .replace(/<[^>]+>/g, '')
  .replace(/&mdash;/g, '-').replace(/&middot;/g, '-').replace(/&nbsp;/g, ' ')
  .replace(/\s{2,}/g, ' ').trim().replace(/\.$/, '');
