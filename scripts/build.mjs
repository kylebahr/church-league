#!/usr/bin/env node
// Builds the whole static site from data/ into site/.
//   node scripts/build.mjs
// Fails loudly on bad config or bad data rather than publishing something wrong.

import fs from 'node:fs';
import path from 'node:path';
import { computeSeason } from './lib/engine.mjs';
import { validatePayouts, buildLedger } from './lib/money.mjs';
import { analyzeWeek, analyzeSeason } from './lib/dfs.mjs';
import { buildRecap, recapHeadline } from './lib/recap.mjs';
import { rotoRace, barList } from './lib/chart.mjs';
import {
  layout, hero, stat, stats, strip, panel, sheet, esc, money, moneyCell, num,
  movementCell, whoami, empty, perfMark,
} from './lib/html.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'site');
const J = p => JSON.parse(fs.readFileSync(path.join(DATA, p), 'utf8'));

const league = J('league.json');
const payouts = J('payouts.json');
const overrides = J('overrides.json');

validatePayouts(payouts, league);
const state = computeSeason({ league, overrides, payouts, dataDir: DATA });
const ledger = buildLedger(state);
const perWeek = state.weeks.map(w => analyzeWeek(w));
const seasonDfs = state.weeks.length ? analyzeSeason(state.weeks) : null;
const lastWeek = state.weeks[state.weeks.length - 1] || null;
const lastAnalysis = perWeek[perWeek.length - 1] || null;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });
for (const f of fs.readdirSync(path.join(ROOT, 'src/assets'))) {
  fs.copyFileSync(path.join(ROOT, 'src/assets', f), path.join(OUT, 'assets', f));
}

const nameOf = u => league.members.find(m => m.username === u)?.name || '';
const wkFile = w => `week-${String(w).padStart(2, '0')}.html`;
const write = (f, html) => fs.writeFileSync(path.join(OUT, f), html);
const cutN = league.schedule.playoffTeams;

/* ------------------------------------------------------------------ banners */
function banners() {
  let out = '';
  const missingNames = league.members.filter(m => !m.name).map(m => m.username);
  const emailsFile = path.join(DATA, 'emails.json');
  const emailCount = fs.existsSync(emailsFile)
    ? (() => { try { const j = JSON.parse(fs.readFileSync(emailsFile, 'utf8'));
        return (Array.isArray(j) ? j : Object.values(j).flat()).filter(v => typeof v === 'string' && v.includes('@')).length;
      } catch { return 0; } })()
    : 0;
  const setup = [];
  if (missingNames.length) setup.push(`No real name on file for <b>${missingNames.map(esc).join(', ')}</b> &mdash; add it in <code>data/league.json</code>.`);
  if (emailCount < league.members.length) setup.push(`Only ${emailCount} of ${league.members.length} email addresses are on file &mdash; add the rest to <code>data/emails.json</code> (gitignored) and the <code>LEAGUE_EMAILS</code> secret.`);
  if (!league.members.some(m => m.paid)) setup.push(`Nobody is marked <code>"paid": true</code> yet, so the pool shows ${money(payouts.poolTotal)} outstanding.`);
  if (setup.length) {
    // NB: this site is public. Never word this as if only the commissioner sees it.
    out += `<div class="callout"><h3>Setup still pending</h3><ul>${setup.map(s => `<li>${s}</li>`).join('')}</ul>
      <p style="margin:9px 0 0;color:var(--text-dim);font-size:12.5px">${esc(league.commissioner.name)} is on it.</p></div>`;
  }
  if (state.warnings.length) {
    out += `<div class="callout warn"><h3>Needs a ruling</h3><ul>${state.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>`;
  }
  return out;
}

/* ------------------------------------------------------- page: standings */
function pageIndex() {
  const s = state.standings;
  const leader = s[0];
  const bubble = s[cutN - 1], firstOut = s[cutN];
  const body = [
    hero({
      title: `Standings`,
      sub: state.weeks.length
        ? `Through <b>Week ${state.lastWeek}</b> &middot; ${league.members.length} teams &middot; cumulative rotisserie points, Weeks ${league.schedule.regularSeasonWeeks.join('&ndash;')}`
        : `No weeks ingested yet.`,
      buttons: [
        `<a class="btn btn-primary" href="${esc(league.links.leagueHome)}" target="_blank" rel="noopener">Enter This Week's Contest</a>`,
        `<a class="btn btn-ghost" href="money.html">See the Money</a>`,
      ],
    }),
    banners(),
  ];

  if (!state.weeks.length) {
    body.push(panel({ title: 'Waiting on Week 1', body: empty('No contest data yet', 'Drop a DraftKings CSV export into data/weeks/ and rebuild.') }));
    return layout({ title: 'Standings', page: 'index.html', league, state, body: body.join('\n') });
  }

  body.push(strip([
    ['Weeks Played', `${state.weeks.filter(w => w.isRegular).length} of ${league.schedule.regularSeasonWeeks[1]}`],
    ['Leader', `${esc(leader.username)} &middot; ${leader.roto} pts`],
    ['Playoff Cut', `${cutN} of ${league.members.length} advance`],
    ['Prize Pool', money(payouts.poolTotal)],
    ['Next Contest', state.nextWeek ? `Week ${state.nextWeek}` : 'Season complete'],
  ]));

  body.push(stats([
    stat({ k: 'Week ' + lastWeek.week + ' High', v: lastWeek.leagueHigh, m: lastWeek.winners.join(', '), tone: 'orange' }),
    stat({ k: 'Week ' + lastWeek.week + ' Average', v: lastWeek.leagueAvg }),
    stat({ k: 'Week ' + lastWeek.week + ' Low', v: lastWeek.leagueLow, m: lastWeek.rows[lastWeek.rows.length - 1].username }),
    stat({ k: 'Best Possible', v: lastAnalysis.best.total, m: 'from the league\'s player pool', tone: 'orange' }),
    stat({ k: 'Bubble', v: `${bubble ? bubble.roto : '-'}`, m: bubble ? `${bubble.username} holds ${cutN}th` : '' }),
  ]));

  // recap
  const recap = buildRecap({ state, week: lastWeek, analysis: lastAnalysis, ledger });
  body.push(panel({
    title: `Week ${lastWeek.week} Recap`,
    note: recapHeadline(lastWeek),
    body: `<div class="recap">${recap.map(p => `<p>${p}</p>`).join('')}</div>
      <div class="btn-row" style="margin-top:15px">
        <a class="btn btn-ghost" href="${wkFile(lastWeek.week)}">Full Week ${lastWeek.week} Results</a>
      </div>`,
  }));

  // race chart
  const race = rotoRace({ state, weeks: state.weeks });
  if (race) body.push(panel({ title: 'The Race', note: 'cumulative roto points', body: race }));

  // standings table
  const rowsHtml = s.map((t, i) => {
    const inPo = i < cutN;
    return `<tr data-team="${esc(t.username)}"${t.rank === 1 ? ' class="leader"' : ''}${i === cutN - 1 ? ' data-cutline="1"' : ''}>
      <td class="rk">${t.rank}</td>
      <td class="num hide-sm">${movementCell(t.movement)}</td>
      <td class="who">${esc(t.username)}${t.name ? `<small>${esc(t.name)}</small>` : ''}</td>
      <td class="num fpts">${t.roto}</td>
      <td class="num">${num(t.pointsFor)}</td>
      <td class="num hide-sm">${num(t.avg)}</td>
      <td class="num hide-sm">${num(t.best)}</td>
      <td class="num hide-sm">${num(t.worst)}</td>
      <td class="num">${t.weeklyWins ? `<span class="pill pill-win">${t.weeklyWins}</span>` : '<span style="color:var(--sheet-dim)">&mdash;</span>'}</td>
      <td class="num hide-sm">${t.misses ? `<span class="pill pill-miss">${t.misses}</span>` : '<span style="color:var(--sheet-dim)">&mdash;</span>'}</td>
      <td>${inPo ? '<span class="pill pill-po">Playoff</span>' : '<span class="pill pill-tb">Toilet</span>'}</td>
    </tr>`;
  }).join('\n');

  body.push(panel({
    title: 'Regular Season',
    note: `tiebreaker is total points-for &middot; dashed line = playoff cut${state.regComplete ? '' : ' (projected)'}`,
    head: whoami(league.members),
    flush: true,
    body: sheet(`<table class="dt"><thead><tr>
      <th>#</th><th class="num hide-sm">Mv</th><th>Team</th>
      <th class="num">Roto</th><th class="num">Points For</th>
      <th class="num hide-sm">Avg</th><th class="num hide-sm">Best</th><th class="num hide-sm">Worst</th>
      <th class="num">Wk W</th><th class="num hide-sm">Miss</th><th>Bracket</th>
    </tr></thead><tbody>${rowsHtml}</tbody></table>`, true),
  }));

  // bubble watch
  if (firstOut) {
    const near = s.slice(Math.max(0, cutN - 3), cutN + 3);
    body.push(panel({
      title: 'Bubble Watch',
      note: `${cutN} teams make the Championship bracket`,
      body: barList(near.map(t => ({
        label: t.username, sub: `${t.rank === cutN ? 'last team in' : t.rank === cutN + 1 ? 'first team out' : `${t.rank}${t.rank <= cutN ? ' in' : ' out'}`}`,
        value: t.roto, color: t.rank <= cutN ? 'var(--green)' : 'var(--red)',
      })), { fmt: v => `${v} pts` }),
    }));
  }

  // brackets, once they exist
  if (state.brackets) {
    const bt = (rows, title, note) => panel({
      title, note, flush: true,
      body: sheet(`<table class="dt"><thead><tr><th>#</th><th>Team</th><th class="num">Roto</th><th class="num">Points For</th></tr></thead>
      <tbody>${rows.map(r => `<tr data-team="${esc(r.username)}"${r.rank === 1 ? ' class="leader"' : ''}>
        <td class="rk">${r.rank}</td><td class="who">${esc(r.username)}${r.name ? `<small>${esc(r.name)}</small>` : ''}</td>
        <td class="num fpts">${r.roto}</td><td class="num">${num(r.pointsFor)}</td></tr>`).join('')}</tbody></table>`),
    });
    body.push(`<div class="grid-2">
      ${bt(state.brackets.playoffs, 'Championship Bracket', 'Weeks 15-18, reset to zero')}
      ${bt(state.brackets.toilet, 'Toilet Bowl', 'Weeks 15-18, reset to zero')}
    </div>`);
  }

  return layout({ title: 'Standings', page: 'index.html', league, state, body: body.join('\n') });
}

/* ----------------------------------------------------------- page: weeks */
function pageWeeks() {
  const regWeeks = state.weeks.filter(w => w.isRegular);
  const allWeeks = [];
  for (let w = league.schedule.regularSeasonWeeks[0]; w <= league.schedule.playoffWeeks[1]; w++) allWeeks.push(w);
  const have = new Set(state.weeks.map(w => w.week));

  const body = [
    hero({ title: 'Weeks', sub: `Every week, every score. ${state.weeks.length} of ${allWeeks.length} contests ingested.` }),
    `<div class="wk-nav" style="margin-bottom:18px">${allWeeks.map(w =>
      have.has(w) ? `<a href="${wkFile(w)}">W${w}</a>` : `<a class="future" href="#">W${w}</a>`).join('')}</div>`,
  ];

  if (!state.weeks.length) {
    body.push(panel({ body: empty('No weeks yet') }));
    return layout({ title: 'Weeks', page: 'weeks.html', league, state, body: body.join('\n') });
  }

  // two matrices: roto points and raw points
  const matrix = (metric, label) => {
    const rows = state.standings.map(t => {
      const cells = state.weeks.map(w => {
        const c = t.byWeek[w.week];
        if (!w.isRegular) {
          const r = w.rows.find(r => r.username === t.username);
          return cell(metric === 'roto' ? null : r?.points, metric, w, t.username);
        }
        return cell(metric === 'roto' ? c?.roto : c?.points, metric, w, t.username);
      });
      const total = metric === 'roto' ? t.roto : num(t.pointsFor);
      return `<tr data-team="${esc(t.username)}"${t.rank === 1 ? ' class="leader"' : ''}>
        <td class="who">${esc(t.username)}</td>${cells.join('')}<td class="num fpts">${total}</td></tr>`;
    }).join('');
    return sheet(`<table class="dt"><thead><tr><th>Team</th>${
      state.weeks.map(w => `<th class="num"><a href="${wkFile(w.week)}" style="color:inherit">W${w.week}</a></th>`).join('')
    }<th class="num">${label}</th></tr></thead><tbody>${rows}</tbody></table>`, true);
  };
  const cell = (v, metric, w, username) => {
    if (v === null || v === undefined) return '<td class="num" style="color:var(--sheet-dim)">&mdash;</td>';
    const isWin = w.winners.includes(username);
    const style = metric === 'roto'
      ? (v >= w.rows.length ? 'font-weight:800;color:#e0491b' : '')
      : (isWin ? 'font-weight:800;color:#e0491b' : '');
    return `<td class="num" style="${style}">${metric === 'roto' ? v : num(v)}</td>`;
  };

  body.push(panel({
    title: 'Rotisserie Points by Week', flush: true,
    note: `high score each week = ${league.members.length} pts &middot; scroll sideways`,
    head: whoami(league.members),
    body: matrix('roto', 'Total'),
  }));
  body.push(panel({
    title: 'Raw Fantasy Points by Week', flush: true,
    note: 'orange = that week\'s high score',
    body: matrix('points', 'Points For'),
  }));

  // week-by-week winners
  body.push(panel({
    title: 'Weekly Prize Winners', flush: true,
    note: `${money(payouts.weekly.amount)} per week, Weeks ${payouts.weekly.weeks.join('&ndash;')}`,
    body: sheet(`<table class="dt"><thead><tr><th>Week</th><th>Winner</th><th class="num">Score</th><th class="num">Margin</th><th class="num">Payout</th><th class="num hide-sm">Low</th><th class="num hide-sm">Avg</th></tr></thead>
    <tbody>${regWeeks.map(w => {
      const margin = w.rows.length > 1 ? Math.round((w.rows[0].points - w.rows[1].points) * 100) / 100 : 0;
      return `<tr><td class="rk"><a href="${wkFile(w.week)}" style="color:inherit;font-weight:800">W${w.week}</a></td>
      <td class="who">${w.winners.map(u => esc(u)).join(' + ')}${w.winners.length === 1 && nameOf(w.winners[0]) ? `<small>${esc(nameOf(w.winners[0]))}</small>` : ''}</td>
      <td class="num fpts">${num(w.leagueHigh)}</td>
      <td class="num">${w.winners.length > 1 ? 'tie' : num(margin)}</td>
      <td class="num"><span class="money-pos">${money(w.cashPerWinner)}${w.winners.length > 1 ? ' ea' : ''}</span></td>
      <td class="num hide-sm">${num(w.leagueLow)}</td><td class="num hide-sm">${num(w.leagueAvg)}</td></tr>`;
    }).join('')}</tbody></table>`),
  }));

  return layout({ title: 'Weeks', page: 'weeks.html', league, state, body: body.join('\n') });
}

/* ------------------------------------------------------ page: week detail */
function pageWeek(w, analysis) {
  const rows = w.rows;
  const allWeeks = state.weeks.map(x => x.week);
  const body = [
    hero({
      title: `Week ${w.week}`,
      sub: `${w.isRegular ? 'Regular season' : 'Playoff week'} &middot; high <b>${w.leagueHigh}</b> &middot; avg ${w.leagueAvg} &middot; low ${w.leagueLow}`,
    }),
    `<div class="wk-nav" style="margin-bottom:18px">${allWeeks.map(x =>
      `<a href="${wkFile(x)}"${x === w.week ? ' aria-current="page"' : ''}>W${x}</a>`).join('')}</div>`,
    strip([
      ['Winner', w.winners.map(esc).join(' + ')],
      ['High Score', num(w.leagueHigh)],
      ['Payout', w.isRegular ? money(w.cashPerWinner) + (w.winners.length > 1 ? ' each' : '') : '&mdash;'],
      ['Entries', `${rows.filter(r => r.entered).length} of ${rows.length}`],
      ['Best Possible', num(analysis.best.total)],
    ]),
  ];

  const recap = buildRecap({ state, week: w, analysis, ledger });
  body.push(panel({ title: `Week ${w.week} Recap`, body: `<div class="recap">${recap.map(p => `<p>${p}</p>`).join('')}</div>` }));

  // results
  body.push(panel({
    title: 'Results', flush: true, head: whoami(league.members),
    note: `roto points: high score gets ${rows.length}`,
    body: sheet(`<table class="dt"><thead><tr><th>#</th><th>Team</th><th class="num">Points</th><th class="num">Roto</th><th class="num hide-sm">vs Avg</th><th>Status</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr data-team="${esc(r.username)}"${i === 0 ? ' class="leader"' : ''}>
      <td class="rk">${i + 1}</td>
      <td class="who">${esc(r.username)}${r.name && r.name !== r.username ? `<small>${esc(r.name)}</small>` : ''}</td>
      <td class="num fpts">${num(r.points)}</td>
      <td class="num">${r.roto}</td>
      <td class="num hide-sm">${r.points >= w.leagueAvg ? `<span class="money-pos">+${num(r.points - w.leagueAvg)}</span>` : `<span class="money-neg">${num(r.points - w.leagueAvg)}</span>`}</td>
      <td>${statusPill(r, w)}</td>
    </tr>`).join('')}</tbody></table>`, true),
  }));

  // best possible lineup
  body.push(panel({
    title: 'Best Possible Lineup',
    note: 'the optimal build from every player this league started',
    body: `<div class="lu">
      <div class="lu-head"><b>League Optimal</b><span class="fp">${num(analysis.best.total)}</span></div>
      <table class="dt"><thead><tr><th>Pos</th><th>Player</th><th class="num">Owned</th><th class="num">FPTS</th></tr></thead>
      <tbody>${analysis.best.lineup.map(p => `<tr><td class="rk">${p.slot}</td>
        <td class="who">${esc(p.player)}</td>
        <td class="num">${(p.drafted * 100).toFixed(1)}%</td>
        <td class="num fpts">${num(p.fpts)} ${perfMark(p.fpts, 25)}</td></tr>`).join('')}</tbody></table>
      <div class="lu-foot">Total <span class="fp">${num(analysis.best.total)}</span></div>
    </div>
    <p style="font-size:12.5px;color:var(--text-faint);margin:12px 0 0">
      Winning score was ${num(w.leagueHigh)}, so <b style="color:var(--orange)">${num(analysis.best.total - w.leagueHigh)}</b> points went unclaimed.
    </p>`,
  }));

  // dfs tables
  body.push(`<div class="grid-2">
    ${panel({
      title: 'Leverage Plays', note: 'points &times; how few people had him', flush: true,
      body: sheet(`<table class="dt"><thead><tr><th>Player</th><th class="num">Owned</th><th class="num">FPTS</th><th class="num">Lev</th></tr></thead>
      <tbody>${analysis.leverage.slice(0, 10).map(p => `<tr><td class="who">${esc(p.player)}<small>${esc(p.pos)}</small></td>
        <td class="num">${(p.drafted * 100).toFixed(1)}%</td><td class="num fpts">${num(p.fpts)}</td>
        <td class="num" style="font-weight:800;color:#e0491b">${num(p.leverage)}</td></tr>`).join('')}</tbody></table>`),
    })}
    ${panel({
      title: 'Busts', note: 'heavily owned, badly burned', flush: true,
      body: sheet(`<table class="dt"><thead><tr><th>Player</th><th class="num">Owned</th><th class="num">Started By</th><th class="num">FPTS</th></tr></thead>
      <tbody>${analysis.busts.slice(0, 10).map(p => `<tr><td class="who">${esc(p.player)}<small>${esc(p.pos)}</small></td>
        <td class="num">${(p.drafted * 100).toFixed(1)}%</td><td class="num">${p.ownedBy}</td>
        <td class="num fpts">${num(p.fpts)} ${perfMark(p.fpts, 99)}</td></tr>`).join('')}</tbody></table>`),
    })}
  </div>`);

  if (analysis.uniques.length) {
    body.push(panel({
      title: 'Solo Starts', note: 'players exactly one manager rolled with', flush: true,
      body: sheet(`<table class="dt"><thead><tr><th>Player</th><th>Only Manager</th><th class="num">FPTS</th></tr></thead>
      <tbody>${analysis.uniques.slice(0, 14).map(p => `<tr data-team="${esc(p.username)}"><td class="who">${esc(p.player)}</td>
        <td>${esc(p.username)}</td><td class="num fpts">${num(p.fpts)} ${perfMark(p.fpts, 25)}</td></tr>`).join('')}</tbody></table>`),
    }));
  }

  // all lineups
  const lineups = rows.filter(r => r.lineup.length).map(r => {
    const fptsOf = new Map(analysis.players.map(p => [p.player, p.fpts]));
    const ownOf = new Map(analysis.players.map(p => [p.player, p.drafted]));
    const order = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'DST'];
    const lu = [...r.lineup].sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot));
    return `<div class="lu" style="margin-bottom:14px">
      <div class="lu-head"><b>${esc(r.username)}</b>${r.name && r.name !== r.username ? `<span style="color:#b9c0c6;font-size:12px">${esc(r.name)}</span>` : ''}<span class="fp">${num(r.points)}</span></div>
      <table class="dt"><thead><tr><th>Pos</th><th>Player</th><th class="num hide-sm">Own</th><th class="num">FPTS</th></tr></thead>
      <tbody>${lu.map(s => {
        const f = fptsOf.get(s.player.trim()) ?? null;
        const o = ownOf.get(s.player.trim()) ?? null;
        return `<tr><td class="rk">${s.slot}</td><td class="who">${esc(s.player)}</td>
          <td class="num hide-sm">${o === null ? '&mdash;' : (o * 100).toFixed(1) + '%'}</td>
          <td class="num fpts">${num(f)} ${f === null ? '' : perfMark(f, 25)}</td></tr>`;
      }).join('')}</tbody></table>
      <div class="lu-foot">Fantasy Points <span class="fp">${num(r.points)}</span></div>
    </div>`;
  }).join('');

  body.push(panel({
    title: 'Every Lineup', note: `${rows.filter(r => r.lineup.length).length} submitted`,
    body: `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:14px">${lineups}</div>`,
  }));

  return layout({ title: `Week ${w.week}`, page: wkFile(w.week), league, state, body: body.join('\n') });
}

function statusPill(r, w) {
  if (w.winners.includes(r.username)) return `<span class="pill pill-win">Won ${money(w.cashPerWinner)}</span>`;
  switch (r.status) {
    case 'late_free': return `<span class="pill pill-late">Late &mdash; free pass #${r.offenseNo}</span>`;
    case 'late_paid': return `<span class="pill pill-late">Late &mdash; paid ${money(r.fine)}</span>`;
    case 'league_low': return `<span class="pill pill-miss">No lineup &mdash; league low</span>`;
    case 'missed_first': return `<span class="pill pill-flag">No lineup &mdash; needs ruling</span>`;
    case 'manual': return `<span class="pill pill-late">Manual</span>`;
    default: return '<span style="color:var(--sheet-dim)">&mdash;</span>';
  }
}

/* ----------------------------------------------------------- page: money */
function pageMoney() {
  const L = ledger;
  const p = L.pool;
  const body = [
    hero({
      title: 'Money',
      sub: `${money(payouts.poolTotal)} pool &middot; ${league.members.length} buy-ins at ${money(league.buyIn)} &middot; every dollar accounted for`,
    }),
    strip([
      ['Prize Pool', money(p.total)],
      ['Weekly Paid', `${money(p.weeklyPaid)} of ${money(payouts.weekly.total)}`],
      ['Weeks Done', `${p.weeksDone} of ${p.regWeekCount}`],
      ['Season Awards', money(p.seasonBuckets)],
      ['Buy-ins In', `${money(p.buyInsCollected)}`],
      ['Outstanding', `${money(p.buyInsOutstanding)}`],
    ]),
  ];

  if (p.finesCollected) {
    body.push(`<div class="callout"><h3>Fines collected</h3><p style="margin:0">${money(p.finesCollected)} in late-lineup fines has been recorded. This is out-of-pocket money on top of the pool &mdash; decide where it goes and note it here.</p></div>`);
  }

  // ledger
  body.push(panel({
    title: 'Ledger', flush: true, head: whoami(league.members),
    note: 'projected awards are based on today\'s standings and will move',
    body: sheet(`<table class="dt"><thead><tr>
      <th>Team</th><th class="num">Wk Wins</th><th class="num">Weekly $</th>
      <th class="num">Banked</th><th class="num">Projected</th><th class="num">Total</th>
      <th class="num hide-sm">Buy-in</th><th class="num hide-sm">Fines</th><th class="num">Net</th>
    </tr></thead><tbody>${L.rows.map(r => `<tr data-team="${esc(r.username)}">
      <td class="who">${esc(r.username)}${r.name && r.name !== r.username ? `<small>${esc(r.name)}</small>` : ''}</td>
      <td class="num">${r.weeklyWins || '<span style="color:var(--sheet-dim)">&mdash;</span>'}</td>
      <td class="num">${r.weeklyCash ? `<span class="money-pos">${money(r.weeklyCash)}</span>` : '<span class="money-zero">&mdash;</span>'}</td>
      <td class="num">${r.earnedTotal ? `<span class="money-pos">${money(r.earnedTotal)}</span>` : '<span class="money-zero">&mdash;</span>'}</td>
      <td class="num">${r.projectedTotal ? `<span style="color:var(--sheet-dim);font-weight:700">${money(r.projectedTotal)}</span>` : '<span class="money-zero">&mdash;</span>'}</td>
      <td class="num fpts">${money(r.total)}</td>
      <td class="num hide-sm"><span class="money-neg">${money(-r.buyIn)}</span>${r.paid ? '' : ' <span class="pill pill-miss">unpaid</span>'}</td>
      <td class="num hide-sm">${r.fines ? `<span class="money-neg">${money(-r.fines)}</span>` : '<span class="money-zero">&mdash;</span>'}</td>
      <td class="num">${moneyCell(r.net)}</td>
    </tr>`).join('')}</tbody></table>`, true),
  }));

  // who is in the black
  const black = L.rows.filter(r => r.net > 0);
  body.push(panel({
    title: 'In the Black',
    note: `${black.length} of ${L.rows.length} are projected to profit`,
    body: black.length
      ? barList(L.rows.filter(r => r.total > 0).map(r => ({
          label: r.username, sub: r.earnedTotal ? `${money(r.earnedTotal)} banked` : 'projected only',
          value: r.total, color: r.net > 0 ? 'var(--green)' : 'var(--orange)',
        })), { fmt: money })
      : empty('Nobody is up yet', 'Every dollar so far is still a buy-in.'),
  }));

  // payout structure
  const bucket = (b, note) => `<div class="lu" style="margin-bottom:14px">
    <div class="lu-head"><b>${esc(b.label)}</b><span class="fp" style="color:var(--green)">${money(b.total)}</span></div>
    <table class="dt"><tbody>${(b.places || []).map(pl => `<tr>
      <td class="who">${ord(pl.place)} place</td><td class="num fpts">${money(pl.amount)}</td></tr>`).join('')}</tbody></table>
    ${note ? `<div class="lu-foot" style="text-transform:none;letter-spacing:0;font-weight:500">${note}</div>` : ''}
  </div>`;

  body.push(panel({
    title: `Payout Structure &mdash; ${money(payouts.poolTotal)}`,
    note: 'derived from the 21-team formula, rescaled to 17',
    body: `<div class="grid-2">
      <div>
        ${bucket({ label: payouts.weekly.label, total: payouts.weekly.total, places: [] },
          `${money(payouts.weekly.amount)} to the week's high scorer, Weeks ${payouts.weekly.weeks.join('&ndash;')}. Ties split.`)}
        ${bucket(payouts.regularSeason, 'Paid after the Super Bowl, on cumulative roto points from Weeks 1&ndash;14.')}
      </div>
      <div>
        ${bucket(payouts.playoffs, `Top ${cutN} teams reset to zero in Week 15. Top 3 aggregate scorers over Weeks 15&ndash;18.`)}
        ${bucket(payouts.toiletBowl, `The other ${league.schedule.toiletBowlTeams} reset to zero. Winner gets their full buy-in back.`)}
      </div>
    </div>
    <div class="callout" style="margin:4px 0 0"><h3>How this was derived</h3>
      <p style="margin:0 0 8px">${esc(payouts.derivation)}</p>
      <p style="margin:0"><b>Worth knowing:</b> holding the weekly prize at ${money(payouts.weekly.amount)} against a smaller pool means weekly money is now
      ${(100 * payouts.weekly.total / payouts.poolTotal).toFixed(1)}% of the pot, up from 26.7% at 21 teams. If you would rather restore the old
      proportions, drop the weekly to ${money(Math.round(payouts.poolTotal * 0.267 / 14))} and push the difference into the season buckets.
      It is one number in <code>data/payouts.json</code>.</p>
    </div>`,
  }));

  return layout({ title: 'Money', page: 'money.html', league, state, body: body.join('\n') });
}
const ord = n => ['', '1st', '2nd', '3rd', '4th', '5th'][n] || `${n}th`;

/* --------------------------------------------------------- page: players */
function pagePlayers() {
  const body = [hero({
    title: 'Players',
    sub: 'Ownership, leverage and chalk, pulled from the columns the spreadsheet threw away.',
  })];

  if (!seasonDfs) {
    body.push(panel({ body: empty('No player data yet') }));
    return layout({ title: 'Players', page: 'players.html', league, state, body: body.join('\n') });
  }

  const allLev = perWeek.flatMap(a => a.leverage.map(p => ({ ...p, week: a.week })))
    .sort((a, b) => b.leverage - a.leverage).slice(0, 20);
  const allBust = perWeek.flatMap(a => a.busts.map(p => ({ ...p, week: a.week })))
    .filter(p => p.drafted >= 0.3).sort((a, b) => a.fpts - b.fpts).slice(0, 20);
  const allUnique = perWeek.flatMap(a => a.uniques.map(p => ({ ...p, week: a.week })))
    .sort((a, b) => b.fpts - a.fpts).slice(0, 20);

  body.push(panel({
    title: 'Most Started', note: 'total roster spots the league has spent on each player', flush: true,
    body: sheet(`<table class="dt"><thead><tr><th>Player</th><th>Pos</th><th class="num">Starts</th>
      <th class="num hide-sm">Weeks</th><th class="num">Avg Wk</th><th class="num">Delivered</th></tr></thead>
    <tbody>${seasonDfs.mostStarted.map(p => `<tr><td class="who">${esc(p.player)}</td><td>${esc(p.pos)}</td>
      <td class="num fpts">${p.starts}</td>
      <td class="num hide-sm">${p.weeks}</td>
      <td class="num">${num(p.avgFpts)}</td>
      <td class="num" style="font-weight:800">${num(p.delivered)}</td></tr>`).join('')}</tbody></table>`)
      + `<p style="font-size:12.5px;color:var(--text-faint);margin:12px 0 0">
        <b>Avg Wk</b> is the player's own average score in weeks someone started him.
        <b>Delivered</b> is the total fantasy points he handed the league &mdash; his score each week
        multiplied by how many managers had him. It is the honest measure of who actually moved money.</p>`,
  }));

  body.push(`<div class="grid-2">
    ${panel({
      title: 'Season Leverage Board', note: 'the calls that actually mattered', flush: true,
      body: sheet(`<table class="dt"><thead><tr><th>Wk</th><th>Player</th><th class="num">Own</th><th class="num">FPTS</th></tr></thead>
      <tbody>${allLev.map(p => `<tr><td class="rk"><a href="${wkFile(p.week)}" style="color:inherit">${p.week}</a></td>
        <td class="who">${esc(p.player)}</td><td class="num">${(p.drafted * 100).toFixed(1)}%</td>
        <td class="num fpts">${num(p.fpts)} ${perfMark(p.fpts, 25)}</td></tr>`).join('')}</tbody></table>`),
    })}
    ${panel({
      title: 'Hall of Busts', note: 'chalk that cratered', flush: true,
      body: sheet(`<table class="dt"><thead><tr><th>Wk</th><th>Player</th><th class="num">Own</th><th class="num">FPTS</th></tr></thead>
      <tbody>${allBust.map(p => `<tr><td class="rk"><a href="${wkFile(p.week)}" style="color:inherit">${p.week}</a></td>
        <td class="who">${esc(p.player)}</td><td class="num">${(p.drafted * 100).toFixed(1)}%</td>
        <td class="num fpts">${num(p.fpts)}</td></tr>`).join('')}</tbody></table>`),
    })}
  </div>`);

  body.push(panel({
    title: 'Chalk Index', note: 'average ownership of the players you start &mdash; low means contrarian', flush: true,
    head: whoami(league.members),
    body: sheet(`<table class="dt"><thead><tr><th>#</th><th>Team</th><th class="num">Chalk</th><th>Most Started</th></tr></thead>
    <tbody>${seasonDfs.managers.map((m, i) => `<tr data-team="${esc(m.username)}">
      <td class="rk">${i + 1}</td>
      <td class="who">${esc(m.username)}${m.name && m.name !== m.username ? `<small>${esc(m.name)}</small>` : ''}</td>
      <td class="num fpts">${(m.chalkiness * 100).toFixed(1)}%</td>
      <td>${m.favorite ? `${esc(m.favorite[0])} <span style="color:var(--sheet-dim)">&times;${m.favorite[1]}</span>` : '&mdash;'}</td>
    </tr>`).join('')}</tbody></table>`, true),
  }));

  if (allUnique.length) body.push(panel({
    title: 'Solo Starts of the Season', note: 'nobody else had him', flush: true,
    body: sheet(`<table class="dt"><thead><tr><th>Wk</th><th>Player</th><th>Manager</th><th class="num">FPTS</th></tr></thead>
    <tbody>${allUnique.map(p => `<tr data-team="${esc(p.username)}"><td class="rk"><a href="${wkFile(p.week)}" style="color:inherit">${p.week}</a></td>
      <td class="who">${esc(p.player)}</td><td>${esc(p.username)}</td>
      <td class="num fpts">${num(p.fpts)} ${perfMark(p.fpts, 25)}</td></tr>`).join('')}</tbody></table>`, true),
  }));

  return layout({ title: 'Players', page: 'players.html', league, state, body: body.join('\n') });
}

/* -------------------------------------------------------------- emit */
write('index.html', pageIndex());
write('weeks.html', pageWeeks());
write('money.html', pageMoney());
write('players.html', pagePlayers());
state.weeks.forEach((w, i) => write(wkFile(w.week), pageWeek(w, perWeek[i])));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
fs.writeFileSync(path.join(OUT, 'data.json'), JSON.stringify({ state, ledger }, null, 1));

console.log(`Built ${4 + state.weeks.length} pages into site/`);
console.log(`  weeks ingested : ${state.weeks.map(w => w.week).join(', ') || 'none'}`);
console.log(`  next week      : ${state.nextWeek ?? 'season complete'}`);
console.log(`  pool           : ${money(payouts.poolTotal)} across ${league.members.length} teams`);
if (state.warnings.length) {
  console.log(`\n${state.warnings.length} thing(s) need a commissioner ruling:`);
  for (const w of state.warnings) console.log(`  ! ${w}`);
}
