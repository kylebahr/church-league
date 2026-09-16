// Money ledger. Every dollar shown on the site is derived here from data/payouts.json.
// Nothing is hardcoded, and the allocation is asserted to close exactly on the pool.

const r2 = n => Math.round(n * 100) / 100;

export function validatePayouts(payouts, league) {
  const errs = [];
  const expectedPool = payouts.teamCount * payouts.buyIn;
  if (payouts.poolTotal !== expectedPool) {
    errs.push(`poolTotal ${payouts.poolTotal} != teamCount x buyIn (${payouts.teamCount} x ${payouts.buyIn} = ${expectedPool})`);
  }
  if (payouts.teamCount !== league.members.length) {
    errs.push(`payouts.teamCount (${payouts.teamCount}) != number of members in league.json (${league.members.length})`);
  }
  const [ws, we] = payouts.weekly.weeks;
  const weeklyTotal = payouts.weekly.amount * (we - ws + 1);
  if (weeklyTotal !== payouts.weekly.total) {
    errs.push(`weekly.total ${payouts.weekly.total} != amount x weeks (${payouts.weekly.amount} x ${we - ws + 1} = ${weeklyTotal})`);
  }
  for (const key of ['regularSeason', 'playoffs', 'toiletBowl']) {
    const b = payouts[key];
    const sum = b.places.reduce((a, p) => a + p.amount, 0);
    if (sum !== b.total) errs.push(`${key}: places sum to ${sum} but total says ${b.total}`);
  }
  const allocated = payouts.weekly.total + payouts.regularSeason.total
    + payouts.playoffs.total + payouts.toiletBowl.total;
  if (allocated !== payouts.poolTotal) {
    errs.push(`allocations sum to $${allocated} but the pool is $${payouts.poolTotal} (off by $${r2(payouts.poolTotal - allocated)})`);
  }
  const bracketSeats = league.schedule.playoffTeams + league.schedule.toiletBowlTeams;
  if (bracketSeats !== league.members.length) {
    errs.push(`playoffTeams + toiletBowlTeams (${bracketSeats}) != member count (${league.members.length})`);
  }
  if (errs.length) {
    throw new Error('data/payouts.json does not balance:\n  - ' + errs.join('\n  - '));
  }
  return { allocated, expectedPool };
}

export function buildLedger(state) {
  const { league, payouts, weeks, standings, brackets, regComplete } = state;
  const buyIn = league.buyIn;
  const led = new Map(league.members.map(m => [m.username, {
    username: m.username, name: m.name || '',
    buyIn, paid: !!m.paid,
    weeklyCash: 0, weeklyWins: 0, fines: 0,
    projected: [], earned: [],
  }]));

  // Weekly high scorer, paid out as each regular-season week completes.
  for (const w of weeks) {
    if (!w.isRegular) continue;
    for (const u of w.winners) {
      const e = led.get(u);
      if (!e) continue;
      e.weeklyCash = r2(e.weeklyCash + w.cashPerWinner);
      e.weeklyWins++;
      e.earned.push({
        label: `Week ${w.week} high score${w.winners.length > 1 ? ` (split ${w.winners.length}-way)` : ''}`,
        amount: w.cashPerWinner, kind: 'weekly',
      });
    }
  }
  // Fines are out-of-pocket, so they are a cost to the member, not winnings.
  for (const s of standings) {
    const e = led.get(s.username);
    if (e) e.fines = s.fines;
  }

  // Season-long buckets: "earned" once the relevant slate is complete, else "projected".
  const attach = (rows, bucket, complete) => {
    for (const p of bucket.places) {
      const row = rows.find(r => r.rank === p.place);
      if (!row) continue;
      const e = led.get(row.username);
      if (!e) continue;
      const item = { label: `${bucket.label} - ${ordinal(p.place)}`, amount: p.amount, kind: complete ? 'final' : 'projected' };
      (complete ? e.earned : e.projected).push(item);
    }
  };
  attach(standings, payouts.regularSeason, regComplete);
  if (brackets) {
    const poComplete = state.weeks.filter(w => w.isPlayoff).length
      >= (league.schedule.playoffWeeks[1] - league.schedule.playoffWeeks[0] + 1);
    attach(brackets.playoffs, payouts.playoffs, poComplete);
    attach(brackets.toilet, payouts.toiletBowl, poComplete);
  }

  const rows = [...led.values()].map(e => {
    const earnedTotal = r2(e.earned.reduce((a, x) => a + x.amount, 0));
    const projectedTotal = r2(e.projected.reduce((a, x) => a + x.amount, 0));
    return {
      ...e, earnedTotal, projectedTotal,
      total: r2(earnedTotal + projectedTotal),
      net: r2(earnedTotal + projectedTotal - buyIn - e.fines),
      netEarnedOnly: r2(earnedTotal - buyIn - e.fines),
    };
  }).sort((a, b) => b.total - a.total || b.net - a.net);

  const weeklyPaid = r2(rows.reduce((a, r) => a + r.weeklyCash, 0));
  const regWeekCount = payouts.weekly.weeks[1] - payouts.weekly.weeks[0] + 1;
  const weeksDone = weeks.filter(w => w.isRegular).length;
  const finesCollected = r2(rows.reduce((a, r) => a + r.fines, 0));

  return {
    rows,
    pool: {
      total: payouts.poolTotal,
      buyInsCollected: r2(league.members.filter(m => m.paid).length * buyIn),
      buyInsOutstanding: r2(league.members.filter(m => !m.paid).length * buyIn),
      weeklyPaid, weeklyRemaining: r2(payouts.weekly.total - weeklyPaid),
      weeksDone, regWeekCount,
      seasonBuckets: r2(payouts.regularSeason.total + payouts.playoffs.total + payouts.toiletBowl.total),
      finesCollected,
    },
  };
}

const ordinal = n => ['', '1st', '2nd', '3rd', '4th', '5th'][n] || `${n}th`;
