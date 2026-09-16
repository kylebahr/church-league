#!/usr/bin/env node
// Weekly league email.
//
//   node scripts/email.mjs launch               # one-time: the site is live
//   node scripts/email.mjs standings            # results + standings are live
//   node scripts/email.mjs reminder             # lineups lock soon, get in
//   node scripts/email.mjs standings --dry      # write the HTML, send nothing
//   node scripts/email.mjs standings --to me@x  # send only to one address
//   node scripts/email.mjs reminder --slot thu-pm  # slot tunes the urgency
//
// Writes a preview to out/email-<kind>.html on every run, including real sends.
// SENDS NOTHING unless GMAIL_USER and GMAIL_APP_PASSWORD are present in the
// environment, so a misconfigured run is a no-op rather than a mistake.

import fs from 'node:fs';
import path from 'node:path';
import { computeSeason } from './lib/engine.mjs';
import { validatePayouts, buildLedger } from './lib/money.mjs';
import { analyzeWeek } from './lib/dfs.mjs';
import { buildRecap, recapHeadline } from './lib/recap.mjs';
import { sendMail } from './lib/smtp.mjs';
import { esc, money } from './lib/html.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'data');
const J = p => JSON.parse(fs.readFileSync(path.join(DATA, p), 'utf8'));

const argv = process.argv.slice(2);
const kind = argv.find(a => !a.startsWith('-')) || 'standings';
const flag = n => argv.includes(`--${n}`);
const val = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
const DRY = flag('dry');
const slot = val('slot') || 'manual';

if (!['launch', 'standings', 'reminder'].includes(kind)) {
  console.error(`Unknown email kind "${kind}". Use "launch", "standings" or "reminder".`);
  process.exit(1);
}

const league = J('league.json');
const payouts = J('payouts.json');
const overrides = J('overrides.json');
const contests = fs.existsSync(path.join(DATA, 'contests.json')) ? J('contests.json') : {};
validatePayouts(payouts, league);

const state = computeSeason({ league, overrides, payouts, dataDir: DATA });
const ledger = buildLedger(state);
const siteUrl = (process.env.SITE_URL || league.links.site || '').replace(/\/$/, '');
const lastWeek = state.weeks[state.weeks.length - 1] || null;
const nextWeek = state.nextWeek;

const seasonContests = contests[String(league.season)] || {};
const contestLink = (nextWeek && seasonContests[String(nextWeek)]) || league.links.leagueHome;
const haveSpecificLink = !!(nextWeek && seasonContests[String(nextWeek)]);

/* ----------------------------------------------------------------- styling */
/**
 * Hybrid: a LIGHT page with DARK cards on it.
 *
 * The light gutter stops the mail reading as one black slab in a white inbox,
 * which is most of what a fully light design bought. What it does not buy is
 * dark-mode safety: the copy inside the cards is still light-on-dark, so a
 * client that auto-inverts can still mangle it - sometimes worse than a
 * uniformly light design, because inversion heuristics run per element and can
 * flip the page while leaving inline card styles alone. Accepted knowingly.
 *
 * Two text contexts, and mixing them up is the easy mistake: the header and
 * footer sit on the LIGHT page and need dark type (pageText/pageDim), while
 * everything inside a card sits on DARK and needs light type (text/body/dim).
 */
const C = {
  bg: '#e9edf1',          // light page
  panel: '#1b1e21',       // dark card
  border: '#2b3035',      // card edge
  pageText: '#14171a',    // type ON the light page
  pageDim: '#5f686f',     // secondary on the light page
  text: '#ffffff',        // headings inside a dark card
  body: '#d7dce1',        // body copy inside a dark card
  dim: '#9aa3ad',         // secondary inside a dark card
  orange: '#f2711c',      // bright orange is fine against #1b1e21
  orangeFill: '#f2711c',
  green: '#53d337',
  greenFill: '#53d337',
  sheet: '#ffffff', sheetAlt: '#f7f9fa', sheetTx: '#16181a', head: '#191d21',
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const shell = (title, inner) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:18px 10px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;font-family:${FONT};">
  <tr><td style="padding:0 0 16px">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="background:${C.orangeFill};border-radius:7px;width:34px;height:34px;text-align:center;color:#fff;font-weight:bold;font-size:15px;font-family:${FONT}">CL</td>
      <td style="padding-left:10px">
        <div style="color:${C.pageText};font-size:16px;font-weight:bold;line-height:1.2">${esc(league.leagueName)}</div>
        <div style="color:${C.pageDim};font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:bold">${esc(league.seasonLabel)}</div>
      </td>
    </tr></table>
  </td></tr>
  ${inner}
  <tr><td style="padding:22px 2px 8px;border-top:1px solid #d4dade;color:${C.pageDim};font-size:11px;line-height:1.6">
    ${esc(league.leagueName)} &middot; ${league.members.length} teams &middot; ${money(payouts.poolTotal)} pool.<br>
    Sent automatically when the standings update.
    Reply to yell at ${esc(league.commissioner.name.split(' ')[0])}; Reply All and the whole league sees it.
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

const card = inner => `<tr><td style="background:${C.panel};border:1px solid ${C.border};border-radius:10px;padding:18px;box-shadow:0 2px 6px rgba(20,23,26,.14)">${inner}</td></tr>
<tr><td style="height:14px;line-height:14px">&nbsp;</td></tr>`;

const h = t => `<div style="color:${C.text};font-size:12px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;margin:0 0 12px">${t}</div>`;

const button = (href, label, primary = true) =>
  `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${primary ? C.greenFill : C.panel};border:1px solid ${primary ? C.greenFill : C.border};border-radius:5px">
    <a href="${esc(href)}" style="display:inline-block;padding:13px 22px;color:${primary ? '#06230b' : C.text};font-family:${FONT};font-size:13px;font-weight:bold;letter-spacing:.05em;text-transform:uppercase;text-decoration:none">${label}</a>
  </td></tr></table>`;

// Rank and team read left; every numeric column reads right.
function sheetTable(headers, rows) {
  const align = i => (i <= 1 ? 'left' : 'right');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.sheet};border-radius:6px;overflow:hidden;border-collapse:collapse">
  <tr>${headers.map((x, i) => `<th style="background:${C.head};color:#cfd5da;font-family:${FONT};font-size:10px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;text-align:${align(i)};padding:8px 10px">${x}</th>`).join('')}</tr>
  ${rows.map((r, ri) => `<tr style="background:${ri % 2 ? C.sheetAlt : C.sheet}">${r.map((c, i) =>
    `<td style="color:${C.sheetTx};font-family:${FONT};font-size:13px;text-align:${align(i)};padding:9px 10px;border-bottom:1px solid #e2e5e8">${c}</td>`).join('')}</tr>`).join('')}
  </table>`;
}

/* ----------------------------------------------------------------- launch */
/** One-time announcement. The standings email assumes they know the site. */
function launchEmail() {
  const cutN = league.schedule.playoffTeams;
  const P = payouts;
  const row = (label, amount, note) => `<tr>
    <td style="color:${C.sheetTx};font-family:${FONT};font-size:13px;padding:9px 10px;border-bottom:1px solid #e2e5e8">
      <b>${label}</b>${note ? `<br><span style="color:#5e666e;font-size:11.5px">${note}</span>` : ''}</td>
    <td style="color:#1a7d10;font-family:${FONT};font-size:13px;font-weight:bold;text-align:right;padding:9px 10px;border-bottom:1px solid #e2e5e8;white-space:nowrap">${money(amount)}</td>
  </tr>`;

  const inner = [
    card(`
      <div style="color:${C.dim};font-size:11px;font-weight:bold;letter-spacing:.1em;text-transform:uppercase">The spreadsheet is retired</div>
      <div style="color:${C.text};font-size:27px;font-weight:bold;line-height:1.15;margin:8px 0 10px">The league site is live</div>
      <div style="color:${C.body};font-size:14px;line-height:1.62;margin-bottom:18px">
        Standings, winnings, every lineup, and a running tally of who owes what &mdash;
        updated within a minute of each week's contest going final. No login, works on your phone.
        Bookmark it.
      </div>
      ${siteUrl ? button(siteUrl, 'Open the League Site') : ''}
      ${siteUrl ? `<div style="margin-top:12px;color:${C.dim};font-size:12px;word-break:break-all">${esc(siteUrl)}</div>` : ''}
    `),
    lastWeek ? card(`${h(`Week ${lastWeek.week} is already up there`)}
      <div style="color:${C.body};font-size:14px;line-height:1.6;margin-bottom:14px">
        <b style="color:${C.orange}">${esc(lastWeek.winners.join(' & '))}</b> took it with
        <b style="color:${C.orange}">${lastWeek.leagueHigh}</b> and
        <span style="color:${C.green};font-weight:bold">${money(lastWeek.cashPerWinner)}</span>.
        League average was ${lastWeek.leagueAvg}.
      </div>
      ${sheetTable(['#', 'Team', 'Roto', 'Pts For'], state.standings.slice(0, 5).map(t => [
        `<b>${t.rank}</b>`,
        `<b>${esc(t.username)}</b>${t.name ? `<br><span style="color:#5e666e;font-size:11px">${esc(t.name)}</span>` : ''}`,
        `<b>${t.roto}</b>`, t.pointsFor.toFixed(2),
      ]))}
      <div style="color:${C.dim};font-size:12px;margin-top:11px">
        Scoring is unchanged: each week the high score gets ${league.members.length} roto points
        down to 1 for last. Verified bit-identical to the old spreadsheet.
      </div>
    `) : '',
    card(`${h(`Payouts updated for ${league.members.length} teams`)}
      <div style="color:${C.body};font-size:14px;line-height:1.6;margin-bottom:14px">
        We landed at <b style="color:${C.text}">${league.members.length} teams</b>, not 21, so the pool is
        <b style="color:${C.green}">${money(P.poolTotal)}</b> and the structure rescaled.
        <b style="color:${C.text}">${cutN} make the playoffs</b>, ${league.schedule.toiletBowlTeams} drop to the Toilet Bowl.
        All ${league.members.length} buy-ins are in.
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.sheet};border-radius:6px;overflow:hidden;border-collapse:collapse">
        ${row('Weekly high scorer', P.weekly.total, `${money(P.weekly.amount)} &times; ${P.weekly.weeks[1] - P.weekly.weeks[0] + 1} weeks, ties split`)}
        ${row('Regular season top 4', P.regularSeason.total, P.regularSeason.places.map(x => money(x.amount)).join(' / '))}
        ${row('Championship playoffs', P.playoffs.total, P.playoffs.places.map(x => money(x.amount)).join(' / '))}
        ${row('Toilet Bowl', P.toiletBowl.total, 'winner gets their buy-in back')}
      </table>
      <div style="color:${C.dim};font-size:12px;margin-top:11px">
        Full breakdown and the running ledger are on the Money page.
      </div>
    `),
    nextWeek ? card(`${h(`Week ${nextWeek}`)}
      <div style="color:${C.body};font-size:14px;line-height:1.6;margin-bottom:14px">
        Get your lineup in before the first kickoff. You cannot submit after that even if none of
        your players are in that game. Miss it and you take the league's lowest score for the week
        &mdash; first offense you get a free pass, after that it is ${money(league.penalty.subsequentFine)} to have a late
        lineup count.
        ${haveSpecificLink ? '' : `<br><br><span style="color:${C.dim};font-size:12.5px">This goes to the league page; the Week ${nextWeek} contest is at the top.</span>`}
      </div>
      ${button(contestLink, `Enter Week ${nextWeek}`)}
    `) : '',
    card(`<div style="color:${C.dim};font-size:12.5px;line-height:1.6">
      Everyone is on the Cc line, so hit Reply All and the whole league sees it.
      That is deliberate.
    </div>`),
  ].join('');

  return {
    subject: `Church League ${league.seasonLabel.replace(' Season', '')}: the league site is live${nextWeek ? ` - Week ${nextWeek} is open` : ''}`,
    html: shell('The league site is live', inner),
  };
}

/* -------------------------------------------------------------- standings */
function standingsEmail() {
  if (!lastWeek) throw new Error('No weeks ingested, so there is nothing to report. Run ingest first.');
  const analysis = analyzeWeek(lastWeek);
  const recap = buildRecap({ state, week: lastWeek, analysis, ledger });
  const top = state.standings.slice(0, 8);
  const cutN = league.schedule.playoffTeams;

  const inner = [
    card(`
      <div style="color:${C.dim};font-size:11px;font-weight:bold;letter-spacing:.1em;text-transform:uppercase">Week ${lastWeek.week} is in the books</div>
      <div style="color:${C.text};font-size:26px;font-weight:bold;line-height:1.15;margin:8px 0 4px">${esc(lastWeek.winners.join(' & '))} ${lastWeek.winners.length > 1 ? 'tie' : 'wins'} with ${lastWeek.leagueHigh}</div>
      <div style="color:${C.green};font-size:15px;font-weight:bold">${money(lastWeek.cashPerWinner)}${lastWeek.winners.length > 1 ? ' each' : ''}</div>
      <div style="margin-top:16px">${siteUrl ? button(siteUrl, 'See Full Standings') : `<span style="color:${C.dim};font-size:13px">Set SITE_URL to include the site link.</span>`}</div>
    `),
    card(`${h(`Week ${lastWeek.week} Recap`)}
      <div style="color:${C.body};font-size:14px;line-height:1.62">${recap.map(p =>
        `<p style="margin:0 0 10px">${p.replace(/class="cash"/g, `style="color:${C.green};font-weight:bold"`).replace(/<b>/g, `<b style="color:${C.orange}">`)}</p>`).join('')}</div>
    `),
    card(`${h('Standings')}
      ${sheetTable(['#', 'Team', 'Roto', 'Pts For'], top.map(t => [
        `<b>${t.rank}</b>`,
        `<b>${esc(t.username)}</b>${t.name ? `<br><span style="color:#5e666e;font-size:11px">${esc(t.name)}</span>` : ''}`,
        `<b>${t.roto}</b>`, t.pointsFor.toFixed(2),
      ]))}
      <div style="color:${C.dim};font-size:12px;margin-top:11px">
        Top ${cutN} of ${league.members.length} make the Championship bracket.
        ${siteUrl ? `<a href="${esc(siteUrl)}" style="color:${C.orange}">Full table &rarr;</a>` : ''}
      </div>
    `),
    nextWeek ? card(`${h(`Week ${nextWeek} is next`)}
      <div style="color:${C.body};font-size:14px;line-height:1.6;margin-bottom:14px">
        Lineups lock at the first kickoff. You cannot enter after that, so do it now.
        ${haveSpecificLink ? '' : `<br><span style="color:${C.dim};font-size:12.5px">This links to the league page &mdash; the Week ${nextWeek} contest link goes here once it exists.</span>`}
      </div>
      ${button(contestLink, `Enter Week ${nextWeek}`)}
    `) : '',
  ].join('');

  return {
    subject: `${recapHeadline(lastWeek)}${nextWeek ? ` - Week ${nextWeek} is open` : ''}`,
    html: shell(`Week ${lastWeek.week} results`, inner),
  };
}

/* --------------------------------------------------------------- reminder */
const LOCK = league.schedule.lockTime || 'the first kickoff';
const URGENCY = {
  'wed-pm': { tag: 'Lineups lock tomorrow', lede: `Get your Week {W} lineup in`,
              line: `Lineups lock at <b>${LOCK}</b> &mdash; tomorrow. Do it now and forget about it.` },
  'thu-am': { tag: 'Lineups lock tonight', lede: `Week {W} locks tonight`,
              line: `Lineups lock at <b>${LOCK}</b>, tonight. This is your working-hours reminder.` },
  'thu-pm': { tag: 'Last call', lede: `Last call on Week {W}`,
              line: `Lineups lock at <b>${LOCK}</b> &mdash; roughly two hours from now. After that the contest will not take an entry, full stop.` },
  manual:   { tag: 'Lineups lock soon', lede: `Get your Week {W} lineup in`,
              line: `Lineups lock at <b>${LOCK}</b>.` },
};

function reminderEmail() {
  if (!nextWeek) throw new Error('Season is complete, so there is no contest to remind anyone about.');
  const u = URGENCY[slot] || URGENCY.manual;
  const cutN = league.schedule.playoffTeams;
  const bubble = state.standings[cutN - 1];
  const inner = [
    card(`
      <div style="color:${C.orange};font-size:11px;font-weight:bold;letter-spacing:.1em;text-transform:uppercase">${esc(u.tag)}</div>
      <div style="color:${C.text};font-size:26px;font-weight:bold;line-height:1.15;margin:8px 0 10px">${u.lede.replace('{W}', nextWeek)}</div>
      <div style="color:${C.body};font-size:14px;line-height:1.6;margin-bottom:16px">
        ${u.line}
        You cannot submit after that, even if none of your players are in the opening game.
        Miss it and you take the league's lowest score for the week &mdash; or ${money(league.penalty.subsequentFine)} out of pocket
        if it is not your first offense.
        ${haveSpecificLink ? '' : `<br><br><span style="color:${C.dim};font-size:12.5px">This links to the league page; the Week ${nextWeek} contest is at the top.</span>`}
      </div>
      ${button(contestLink, `Enter Week ${nextWeek}`)}
    `),
    lastWeek ? card(`${h('Where things stand')}
      ${sheetTable(['#', 'Team', 'Roto'], state.standings.slice(0, 5).map(t => [
        `<b>${t.rank}</b>`, `<b>${esc(t.username)}</b>`, `<b>${t.roto}</b>`,
      ]))}
      <div style="color:${C.dim};font-size:12px;margin-top:11px">
        ${bubble ? `${esc(bubble.username)} holds the last playoff spot at ${bubble.roto} roto points. ` : ''}
        ${siteUrl ? `<a href="${esc(siteUrl)}" style="color:${C.orange}">Full standings &rarr;</a>` : ''}
      </div>
    `) : '',
  ].join('');

  const subjects = {
    'wed-pm': `Week ${nextWeek} is open - lineups lock ${LOCK}`,
    'thu-am': `Week ${nextWeek} lineups lock tonight`,
    'thu-pm': `Last call: Week ${nextWeek} locks in about two hours`,
    manual: `Week ${nextWeek} lineups lock soon - get in`,
  };
  return {
    subject: subjects[slot] || subjects.manual,
    html: shell(`Week ${nextWeek} reminder`, inner),
  };
}

/* ------------------------------------------------------------------- send */
const { subject, html } = kind === 'launch' ? launchEmail()
  : kind === 'standings' ? standingsEmail() : reminderEmail();

const outDir = path.join(ROOT, 'out');
fs.mkdirSync(outDir, { recursive: true });
const preview = path.join(outDir, `email-${kind}.html`);
fs.writeFileSync(preview, html);

// --once: refuse to send the same email twice for the same week. Without this a
// weekly cron would re-send Tuesday's results every Tuesday until new data lands.
const LOG_PATH = path.join(DATA, 'email-log.json');
// Dedupe granularity differs by kind, on purpose:
//   launch    - once per season, ever
//   standings - once per week, so a Tuesday cron cannot re-send last week's
//   reminder  - once per DAY. There are deliberately two reminder crons
//               (Wed evening and Thu morning) for the same week, and keying
//               those by week would make Thursday's look like a duplicate and
//               silently drop it.
const today = new Date().toISOString().slice(0, 10);
const logKey = kind === 'launch'
  ? `launch:${league.season}`
  : kind === 'standings'
    ? `standings:${league.season}:${lastWeek ? lastWeek.week : '?'}`
    // Keyed by SLOT, not by date: there are three reminder sends a week and two
    // of them (Thursday morning and Thursday evening) share a UTC date, so a
    // date key would drop the second as a duplicate.
    : `reminder:${league.season}:${nextWeek}:${slot}`;
const readLog = () => {
  try { return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); } catch { return {}; }
};
if (flag('once')) {
  const log = readLog();
  if (log[logKey]) {
    console.log(`Already sent "${logKey}" at ${log[logKey]}. Nothing to do.`);
    process.exit(0);
  }
}

/**
 * Recipients never live in git. Resolution order:
 *   1. LEAGUE_EMAILS env/secret - comma, semicolon or newline separated
 *   2. data/emails.json         - local only, gitignored
 * Anything that is not a plausible address is dropped rather than guessed at.
 */
function resolveRecipients() {
  const clean = list => [...new Set(list
    .map(e => String(e).trim().replace(/^.*<|>.*$/g, '').toLowerCase())
    .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))];

  const env = process.env.LEAGUE_EMAILS;
  if (env && env.trim()) return { src: 'LEAGUE_EMAILS secret', list: clean(env.split(/[,;\n]/)) };

  const local = path.join(DATA, 'emails.json');
  if (fs.existsSync(local)) {
    const j = JSON.parse(fs.readFileSync(local, 'utf8'));
    const list = Array.isArray(j) ? j : Object.values(j).flat();
    return { src: 'data/emails.json', list: clean(list.filter(v => typeof v === 'string')) };
  }
  return { src: 'nowhere', list: [] };
}

const only = val('to');
const resolved = resolveRecipients();
// The SMTP account is the sender, not a league member. Everyone else on the
// list is a recipient - including the commissioner, whose personal address is
// NOT the sending address when a separate automation account does the sending.
const senderAddr = (process.env.GMAIL_USER || '').trim().toLowerCase();
const recipients = only
  ? [only]
  : resolved.list.filter(e => e !== senderAddr);

console.log(`kind      : ${kind}`);
console.log(`subject   : ${subject}`);
console.log(`preview   : ${path.relative(ROOT, preview)}`);
console.log(`recipients: ${recipients.length}${only ? ' (--to override)' : ` from ${resolved.src}`}`);
if (!only && process.env.GMAIL_USER) {
  console.log(`sending as: ${senderAddr}  (replies -> ${league.commissioner.email})`);
}

if (DRY) { console.log('\nDRY RUN - nothing sent.'); process.exit(0); }

const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
if (!user || !pass) {
  console.log('\nGMAIL_USER / GMAIL_APP_PASSWORD not set - nothing sent. Preview written above.');
  process.exit(0);
}
if (!recipients.length) {
  console.error(
    '\nNo recipient addresses found, so nothing was sent.\n' +
    `  Looked in: LEAGUE_EMAILS env (${process.env.LEAGUE_EMAILS ? 'set' : 'NOT set'}), ` +
    `then ${path.relative(ROOT, path.join(DATA, 'emails.json'))} (${fs.existsSync(path.join(DATA, 'emails.json')) ? 'present' : 'absent'}).\n` +
    '  In CI the LEAGUE_EMAILS secret must be passed to the step env - the file is gitignored.'
  );
  // Exit non-zero: a real send that reached nobody is a failure, not a no-op.
  // Reporting success here is how a missing secret went unnoticed through an
  // entire "successful" send.
  process.exit(1);
}

// Everyone is Cc'd on purpose: these are 17 guys who all know each other, and
// a visible Cc list means Reply All reaches the whole league. Not Bcc.
// Replies go to the commissioner's real inbox, not the automation account.
const res = await sendMail({
  user, pass,
  from: `${league.leagueName} (${league.commissioner.name}) <${user}>`,
  ...(only ? { to: [only] } : { to: [user], cc: recipients }),
  replyTo: league.commissioner.email,
  subject, html,
});
console.log(`\nSent to ${res.accepted} address(es) from ${user}.`);

if (flag('once') && !only) {
  const log = readLog();
  log[logKey] = new Date().toISOString();
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2) + '\n');
  console.log(`Recorded "${logKey}" in data/email-log.json.`);
}
