// Templated weekly recap. Deterministic: same inputs always produce the same
// prose, so the site and the email never disagree. Phrasing is varied by week
// number rather than randomness so rebuilds are stable.

const r2 = n => Math.round(n * 100) / 100;
const money = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const pick = (arr, seed) => arr[seed % arr.length];

export function buildRecap({ state, week, analysis, ledger }) {
  const { standings, league, payouts } = state;
  const seed = week.week;
  const rows = week.rows;
  const top = rows[0], second = rows[1], last = rows[rows.length - 1];
  const nameOf = u => (state.league.members.find(m => m.username === u)?.name) || u;
  const P = [];

  // --- the win
  const margin = r2(top.points - second.points);
  const cash = week.isRegular ? week.cashPerWinner : 0;
  if (week.winners.length > 1) {
    P.push(`<b>${week.winners.join(' and ')}</b> both posted <b>${top.points}</b> and split the weekly prize ${week.winners.length} ways at <span class="cash">${money(cash)}</span> apiece. Of all the ways to win money, tying is the least satisfying.`);
  } else {
    const verbs = ['took the week', 'ran away with it', 'won the week outright', 'posted the high score'];
    P.push(
      `<b>${top.username}</b> ${pick(verbs, seed)} with <b>${top.points}</b>` +
      (week.isRegular ? `, good for <span class="cash">${money(cash)}</span>.` : '.') +
      (margin > 20
        ? ` That is a <b>${margin}</b>-point margin over ${second.username} — not close, not lucky.`
        : margin < 3
          ? ` ${second.username} missed it by <b>${margin}</b>. Somewhere in that lineup is a decision worth ${money(cash)}.`
          : ` ${second.username} finished ${margin} back.`)
    );
  }

  // --- what actually won it
  const lev = analysis.leverage[0];
  const uni = analysis.uniques[0];
  if (uni && uni.fpts > 25) {
    P.push(`The week's sharpest call: <b>${uni.player}</b> for <b>${uni.fpts}</b>, started by exactly one manager in the league — ${uni.username}. Everyone else watched.`);
  } else if (lev && lev.drafted <= 0.25 && lev.fpts > 20) {
    P.push(`Best leverage play of the week was <b>${lev.player}</b>: <b>${lev.fpts}</b> points at just ${pctS(lev.drafted)} rostered.`);
  }

  // --- the bust
  const bust = analysis.busts.find(b => b.drafted >= 0.3);
  if (bust) {
    P.push(`<b>${bust.player}</b> was the trap. ${pctS(bust.drafted)} of the league started him and he returned <b>${bust.fpts}</b>. ${bust.ownedBy} of you have only yourselves to blame.`);
  }

  // --- left on the table
  const best = analysis.best;
  if (best.total > top.points) {
    P.push(`The best lineup buildable from the players this league actually started was worth <b>${best.total}</b>. The winning score was ${top.points}. Collectively you left <b>${r2(best.total - top.points)}</b> points in the bin.`);
  }

  // --- the floor
  const floorLines = [
    `Bottom of the week: <b>${last.username}</b> at <b>${last.points}</b>.`,
    `Somebody has to finish last. This week it was <b>${last.username}</b> with <b>${last.points}</b>.`,
    `<b>${last.username}</b> brought up the rear at <b>${last.points}</b>.`,
  ];
  P.push(`${pick(floorLines, seed)} League average was ${week.leagueAvg}, and ${rows.filter(r => r.points > week.leagueAvg).length} of ${rows.length} cleared it.`);

  // --- missed lineups
  const missed = rows.filter(r => !r.entered);
  if (missed.length) {
    const bits = missed.map(r => {
      if (r.status === 'late_free') return `${r.username} (offense #${r.offenseNo}, free pass used)`;
      if (r.status === 'late_paid') return `${r.username} (offense #${r.offenseNo}, paid the ${money(league.penalty.subsequentFine)})`;
      return `${r.username} (offense #${r.offenseNo}, took the league low of ${week.leagueLow})`;
    });
    P.push(`No lineup submitted: <b>${bits.join(', ')}</b>. Every degenerate finds a way to get their bets in on time.`);
  }

  // --- the race
  const leader = standings[0];
  const cutIdx = league.schedule.playoffTeams - 1;
  const bubble = standings[cutIdx];
  const firstOut = standings[cutIdx + 1];
  if (state.weeks.length > 1 && bubble && firstOut) {
    P.push(
      `<b>${leader.username}</b> leads the season at <b>${leader.roto}</b> roto points. ` +
      `The playoff cut sits at ${leader.roto === bubble.roto ? '' : ''}<b>${bubble.roto}</b> — ` +
      `${bubble.username} holds the last spot, ${firstOut.username} is ` +
      (bubble.roto === firstOut.roto ? `tied with him and losing the points-for tiebreak` : `<b>${bubble.roto - firstOut.roto}</b> back`) + `.`
    );
  }

  return P;
}

/** One-line summary for email subject lines and cards. */
export function recapHeadline(week) {
  const w = week.winners;
  return w.length > 1
    ? `Week ${week.week}: ${w.join(' & ')} tie at ${week.leagueHigh}`
    : `Week ${week.week}: ${w[0]} wins with ${week.leagueHigh}`;
}

const pctS = d => (d * 100).toFixed(1) + '%';
