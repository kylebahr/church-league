// DFS analytics built from the %Drafted and FPTS columns the old spreadsheet discarded.
//
// A DK export lists each player once per roster slot they were started in, so
// "Jahmyr Gibbs RB 52.94%" and "Jahmyr Gibbs FLEX 11.76%" are the same human at
// 64.7% total league ownership. Everything here dedupes on player name first.

const r2 = n => Math.round(n * 100) / 100;
const ROSTER = { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, DST: 1 };
const FLEX_ELIGIBLE = new Set(['RB', 'WR', 'TE']);

/** Collapse the per-slot player rows into one row per player, summing ownership. */
export function dedupePlayers(players) {
  const byName = new Map();
  for (const p of players) {
    const name = p.player.trim();
    if (!name) continue;
    const cur = byName.get(name);
    if (cur) {
      cur.drafted = r2v(cur.drafted + (p.drafted ?? 0));
      cur.slots.add(p.slot);
      if (p.fpts !== null) cur.fpts = p.fpts;
      // The "true" position is the non-FLEX one when both appear.
      if (p.slot !== 'FLEX') cur.pos = p.slot;
    } else {
      byName.set(name, {
        player: name, pos: p.slot === 'FLEX' ? null : p.slot,
        slots: new Set([p.slot]), drafted: p.drafted ?? 0, fpts: p.fpts ?? 0,
      });
    }
  }
  // A player only ever started at FLEX still needs a real position guess.
  for (const p of byName.values()) if (!p.pos) p.pos = 'FLEX';
  return [...byName.values()].map(p => ({ ...p, slots: [...p.slots] }));
}
const r2v = n => Math.round(n * 10000) / 10000;

export function analyzeWeek(week) {
  const players = dedupePlayers(week.players);
  const entered = week.rows.filter(r => r.entered);

  // Leverage: big score at low ownership. Weighted so a 36-pt play at 6% owned
  // outranks a 38-pt play everyone had.
  const leverage = players
    .filter(p => p.fpts > 0 && p.drafted > 0)
    .map(p => ({ ...p, leverage: r2(p.fpts * (1 - p.drafted)) }))
    .sort((a, b) => b.leverage - a.leverage)
    .slice(0, 12);

  // Busts: heavily owned AND genuinely bad. In a 17-man league only a handful of
  // players clear 20% ownership, so an unfiltered "lowest scorer above 20%" list
  // will happily label a 31-point week a bust. Require the score to also sit
  // below the median of every player started this week.
  const scored = players.map(p => p.fpts).filter(v => v !== null).sort((a, b) => a - b);
  const median = scored.length ? scored[Math.floor(scored.length / 2)] : 0;
  const busts = players
    .filter(p => p.drafted >= 0.2 && p.fpts < median)
    .map(p => ({ ...p, ownedBy: Math.round(p.drafted * week.rows.length), median: r2(median) }))
    .sort((a, b) => (a.fpts - b.fpts) || (b.drafted - a.drafted))
    .slice(0, 10);

  const chalk = [...players].sort((a, b) => b.drafted - a.drafted).slice(0, 12);
  const topScorers = [...players].sort((a, b) => b.fpts - a.fpts).slice(0, 12);

  return {
    week: week.week,
    players: players.sort((a, b) => b.fpts - a.fpts),
    leverage, busts, chalk, topScorers,
    best: bestAvailableLineup(players),
    uniques: uniquePlays(week, players),
    entryCount: entered.length,
  };
}

/**
 * The best 9-man lineup constructible from the players the league collectively
 * started this week. Not a true DFS optimal (it ignores salary and every player
 * nobody rostered) - it is "the best you could have done with the league's pool",
 * which is the comparison that actually stings.
 */
export function bestAvailableLineup(players) {
  const pool = players.filter(p => p.fpts !== null);
  const byPos = pos => pool.filter(p => p.pos === pos).sort((a, b) => b.fpts - a.fpts);
  const used = new Set();
  const take = (pos, n) => {
    const out = [];
    for (const p of byPos(pos)) {
      if (out.length >= n) break;
      if (used.has(p.player)) continue;
      used.add(p.player); out.push({ ...p, slot: pos });
    }
    return out;
  };
  const picks = [
    ...take('QB', ROSTER.QB), ...take('RB', ROSTER.RB),
    ...take('WR', ROSTER.WR), ...take('TE', ROSTER.TE),
  ];
  const flex = pool
    .filter(p => !used.has(p.player) && (FLEX_ELIGIBLE.has(p.pos) || p.pos === 'FLEX'))
    .sort((a, b) => b.fpts - a.fpts)[0];
  if (flex) { used.add(flex.player); picks.push({ ...flex, slot: 'FLEX' }); }
  picks.push(...take('DST', ROSTER.DST));
  const order = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'DST'];
  picks.sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot) || b.fpts - a.fpts);
  return { lineup: picks, total: r2(picks.reduce((a, p) => a + p.fpts, 0)) };
}

/** Players started by exactly one manager, credited to that manager. */
export function uniquePlays(week, players) {
  const owners = new Map();
  for (const r of week.rows) {
    if (!r.entered) continue;
    for (const s of r.lineup) {
      const key = s.player.trim();
      if (!owners.has(key)) owners.set(key, []);
      owners.get(key).push(r.username);
    }
  }
  const fptsOf = new Map(players.map(p => [p.player, p.fpts]));
  const out = [];
  for (const [player, users] of owners) {
    if (users.length !== 1) continue;
    out.push({ player, username: users[0], fpts: fptsOf.get(player) ?? 0 });
  }
  return out.sort((a, b) => b.fpts - a.fpts);
}

/** Season-long ownership and per-manager tendencies. */
export function analyzeSeason(weeks) {
  const tally = new Map();
  const perManager = new Map();
  for (const w of weeks) {
    const players = dedupePlayers(w.players);
    const fptsOf = new Map(players.map(p => [p.player, p.fpts]));
    for (const p of players) {
      const t = tally.get(p.player)
        || { player: p.player, pos: p.pos, starts: 0, fpts: 0, weeks: 0, delivered: 0 };
      const startsThisWeek = Math.round(p.drafted * w.rows.length);
      t.starts += startsThisWeek;
      t.fpts = r2(t.fpts + p.fpts);          // his own production, summed over weeks
      t.delivered = r2(t.delivered + p.fpts * startsThisWeek); // points he handed the league
      t.weeks++;
      tally.set(p.player, t);
    }
    for (const r of w.rows) {
      if (!r.entered) continue;
      const m = perManager.get(r.username) || { username: r.username, name: r.name, players: new Map(), chalkScore: 0, weeks: 0 };
      m.weeks++;
      let owned = 0;
      for (const s of r.lineup) {
        m.players.set(s.player, (m.players.get(s.player) || 0) + 1);
        const p = players.find(x => x.player === s.player.trim());
        if (p) owned += p.drafted;
      }
      m.chalkScore = r2(m.chalkScore + owned / Math.max(1, r.lineup.length));
      perManager.set(r.username, m);
    }
  }
  const mostStarted = [...tally.values()]
    .map(t => ({ ...t, avgFpts: r2(t.weeks ? t.fpts / t.weeks : 0) }))
    .sort((a, b) => b.starts - a.starts).slice(0, 25);
  const managers = [...perManager.values()].map(m => ({
    username: m.username, name: m.name,
    chalkiness: r2(m.chalkScore / Math.max(1, m.weeks)),
    favorite: [...m.players.entries()].sort((a, b) => b[1] - a[1])[0] || null,
  })).sort((a, b) => b.chalkiness - a.chalkiness);
  return { mostStarted, managers };
}
