// Rotisserie scoring engine. Ported formula-for-formula from the retired
// "Church League Standings" workbook so results are bit-identical to prior seasons.
//
//   Weekly roto points = Excel RANK(score, all_scores_that_week, 1)   [ascending]
//     -> with 17 teams the week's high scorer gets 17, the low scorer gets 1.
//     -> Excel tie behavior preserved: tied teams SHARE a rank and the next is skipped.
//        (Two teams tied for the weekly high both get 16, and nobody gets 17.)
//
//   Season rank = RANK(cumRoto, all, 0) + COUNT(cumRoto == mine AND pointsFor > mine)
//     -> exactly the workbook's RANK+SUMPRODUCT construction.
//
//   Weeks 15-18 reset every tally to zero and rank WITHIN each bracket only,
//   so the 7-team playoff pool maxes at 7 roto points per week and the
//   10-team Toilet Bowl maxes at 10.

import fs from 'node:fs';
import path from 'node:path';
import { parseContestStandings } from './csv.mjs';

/** Excel RANK(value, range, 1) - ascending, ties share the lower rank. */
export function rankAsc(value, values) {
  let less = 0;
  for (const v of values) if (v < value) less++;
  return less + 1;
}
/** Excel RANK(value, range, 0) - descending, ties share the better rank. */
export function rankDesc(value, values) {
  let greater = 0;
  for (const v of values) if (v > value) greater++;
  return greater + 1;
}
const r2 = n => Math.round(n * 100) / 100;

export function loadWeekFiles(dataDir, season) {
  const dir = path.join(dataDir, 'weeks');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map(f => {
      const m = f.match(new RegExp(`^${season}-w(\\d{1,2})\\.csv$`, 'i'));
      return m ? { week: Number(m[1]), file: path.join(dir, f), name: f } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.week - b.week);
}

/**
 * @returns the complete computed league state consumed by the site + email builders.
 */
export function computeSeason({ league, overrides, payouts, dataDir }) {
  const season = String(league.season);
  const members = league.members;
  const byUsername = new Map(members.map(m => [m.username.toLowerCase(), m]));
  const [regStart, regEnd] = league.schedule.regularSeasonWeeks;
  const [poStart, poEnd] = league.schedule.playoffWeeks;
  const seasonOverrides = (overrides && overrides[season]) || {};

  const files = loadWeekFiles(dataDir, season);
  const warnings = [];
  const offenseCount = new Map(members.map(m => [m.username, 0]));
  const weeks = [];

  for (const { week, file, name } of files) {
    const raw = parseContestStandings(fs.readFileSync(file, 'utf8'));
    const wOverrides = seasonOverrides[String(week)] || {};

    // Reconcile DK entry names against the roster.
    const entryByUser = new Map();
    for (const e of raw.entries) {
      const m = byUsername.get(e.username.toLowerCase());
      if (!m) {
        warnings.push(`Week ${week} (${name}): entry "${e.username}" is not in data/league.json members. Its score is ignored.`);
        continue;
      }
      entryByUser.set(m.username, e);
    }
    for (const m of members) {
      if (!entryByUser.has(m.username) && !wOverrides[m.username]) {
        // no entry and no ruling -> automatic no-show
      }
    }

    // League low is the lowest score an actual submitted lineup produced.
    const submitted = [...entryByUser.values()].map(e => e.points).filter(p => p !== null);
    const leagueLow = submitted.length ? Math.min(...submitted) : 0;

    // Resolve every roster member's official score for the week.
    const rows = [];
    for (const m of members) {
      const entry = entryByUser.get(m.username) || null;
      const ov = wOverrides[m.username] || null;
      const entered = !!entry;
      let points, status, fine = 0, note = ov?.note || '';

      if (!entered) offenseCount.set(m.username, offenseCount.get(m.username) + 1);
      const offenseNo = entered ? null : offenseCount.get(m.username);

      if (ov) {
        switch (ov.ruling) {
          case 'late_lineup':
            points = req(ov, week, m, 'late_lineup'); status = 'late_free'; break;
          case 'fine_paid':
            points = req(ov, week, m, 'fine_paid'); status = 'late_paid';
            fine = league.penalty.subsequentFine; break;
          case 'league_low':
            points = leagueLow; status = 'league_low'; break;
          case 'score':
            points = req(ov, week, m, 'score'); status = 'manual'; break;
          default:
            throw new Error(`Unknown ruling "${ov.ruling}" for ${m.username} week ${week} in data/overrides.json`);
        }
      } else if (entered) {
        points = entry.points; status = 'ok';
      } else {
        // No lineup, no ruling. Default to the league low and flag it for the commissioner.
        points = leagueLow;
        status = offenseNo === 1 ? 'missed_first' : 'league_low';
        warnings.push(
          offenseNo === 1
            ? `Week ${week}: ${m.username} submitted no lineup (offense #1 - entitled to a free late lineup). Defaulted to league low ${r2(leagueLow)}. Add a "late_lineup" ruling in data/overrides.json to credit their real score.`
            : `Week ${week}: ${m.username} submitted no lineup (offense #${offenseNo}). League low ${r2(leagueLow)} applied. If they paid the $${league.penalty.subsequentFine}, add a "fine_paid" ruling in data/overrides.json.`
        );
      }

      rows.push({
        username: m.username, name: m.name || '',
        points: r2(points), entered, status, offenseNo, fine, note,
        lineup: entry ? entry.lineup : [],
        dkRank: entry ? entry.rank : null,
      });
    }

    // Weekly roto points over ALL roster members, Excel-ascending.
    const allScores = rows.map(r => r.points);
    for (const r of rows) r.roto = rankAsc(r.points, allScores);

    const high = Math.max(...allScores);
    const winners = rows.filter(r => r.points === high).map(r => r.username);
    const isRegular = week >= regStart && week <= regEnd;

    weeks.push({
      week, file: name, isRegular,
      isPlayoff: week >= poStart && week <= poEnd,
      rows: rows.sort((a, b) => b.points - a.points),
      leagueLow: r2(leagueLow), leagueHigh: r2(high),
      leagueAvg: r2(allScores.reduce((a, b) => a + b, 0) / allScores.length),
      winners,
      cashPerWinner: isRegular ? r2(payouts.weekly.amount / winners.length) : 0,
      players: raw.players,
    });
  }

  const regWeeks = weeks.filter(w => w.isRegular);
  const poWeeks = weeks.filter(w => w.isPlayoff);

  const standings = buildStandings(members, regWeeks);
  const prevStandings = buildStandings(members, regWeeks.slice(0, -1));
  const prevRank = new Map(prevStandings.map(s => [s.username, s.rank]));
  // Movement is meaningless until at least two weeks exist: with zero weeks
  // every team ties at 0 roto and would read as a 16-place fall.
  const hasPrior = regWeeks.length >= 2;
  for (const s of standings) {
    const p = hasPrior ? prevRank.get(s.username) : null;
    s.prevRank = p ?? null;
    s.movement = p == null ? null : p - s.rank;
  }

  // Bracket split is only meaningful once the regular season is complete.
  const regComplete = regWeeks.length >= (regEnd - regStart + 1);
  const playoffPool = standings.slice(0, league.schedule.playoffTeams).map(s => s.username);
  const toiletPool = standings.slice(league.schedule.playoffTeams).map(s => s.username);

  const brackets = poWeeks.length ? {
    playoffs: buildBracket(members, poWeeks, playoffPool),
    toilet: buildBracket(members, poWeeks, toiletPool),
  } : null;

  return {
    season, league, payouts,
    generatedAt: new Date().toISOString(),
    weeks, standings, brackets,
    playoffPool, toiletPool, regComplete,
    lastWeek: weeks.length ? weeks[weeks.length - 1].week : null,
    nextWeek: nextWeekNumber(weeks, regStart, poEnd),
    warnings,
  };
}

function req(ov, week, m, ruling) {
  if (typeof ov.points !== 'number') {
    throw new Error(`data/overrides.json: ruling "${ruling}" for ${m.username} week ${week} requires a numeric "points" value.`);
  }
  return ov.points;
}

function buildStandings(members, weeks) {
  const out = members.map(m => {
    const mine = weeks.map(w => w.rows.find(r => r.username === m.username)).filter(Boolean);
    return {
      username: m.username, name: m.name || '',
      roto: mine.reduce((a, r) => a + r.roto, 0),
      pointsFor: r2(mine.reduce((a, r) => a + r.points, 0)),
      weeklyWins: weeks.filter(w => w.winners.includes(m.username)).length,
      best: mine.length ? r2(Math.max(...mine.map(r => r.points))) : 0,
      worst: mine.length ? r2(Math.min(...mine.map(r => r.points))) : 0,
      avg: mine.length ? r2(mine.reduce((a, r) => a + r.points, 0) / mine.length) : 0,
      misses: mine.filter(r => !r.entered).length,
      fines: mine.reduce((a, r) => a + r.fine, 0),
      byWeek: Object.fromEntries(weeks.map((w, i) => [w.week, {
        points: mine[i]?.points ?? null, roto: mine[i]?.roto ?? null,
        status: mine[i]?.status ?? null,
      }])),
    };
  });
  const rotos = out.map(o => o.roto);
  for (const o of out) {
    // Workbook formula: RANK(desc) + count of teams tied on roto with MORE points-for.
    o.rank = rankDesc(o.roto, rotos)
      + out.filter(x => x.roto === o.roto && x.pointsFor > o.pointsFor).length;
  }
  return out.sort((a, b) => a.rank - b.rank);
}

/** Weeks 15-18: tallies reset to zero and roto is ranked within the bracket only. */
function buildBracket(members, poWeeks, pool) {
  const poolSet = new Set(pool);
  const rows = members.filter(m => poolSet.has(m.username)).map(m => ({
    username: m.username, name: m.name || '',
    roto: 0, pointsFor: 0, byWeek: {},
  }));
  for (const w of poWeeks) {
    const inPool = w.rows.filter(r => poolSet.has(r.username));
    const scores = inPool.map(r => r.points);
    for (const r of inPool) {
      const roto = rankAsc(r.points, scores);
      const t = rows.find(x => x.username === r.username);
      t.roto += roto; t.pointsFor = r2(t.pointsFor + r.points);
      t.byWeek[w.week] = { points: r.points, roto };
    }
  }
  const rotos = rows.map(r => r.roto);
  for (const r of rows) {
    r.rank = rankDesc(r.roto, rotos)
      + rows.filter(x => x.roto === r.roto && x.pointsFor > r.pointsFor).length;
  }
  return rows.sort((a, b) => a.rank - b.rank);
}

function nextWeekNumber(weeks, regStart, poEnd) {
  const have = new Set(weeks.map(w => w.week));
  for (let w = regStart; w <= poEnd; w++) if (!have.has(w)) return w;
  return null;
}
