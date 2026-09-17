// Lock-time arithmetic.
//
// The scheduled sends cannot assume they ran on time. GitHub's cron has been
// observed running 90+ minutes late on this repo, which matters because a
// reminder that says "locks in roughly two hours" is wrong if it goes out 90
// minutes late - and a reminder that goes out AFTER lock is worse than none at
// all, since it tells people to enter a contest that will not accept them.
//
// So the email asks the clock, not the scheduler.

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Minutes that wall-clock time in `tz` is ahead of UTC at this instant. */
export function tzOffsetMinutes(date, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map(x => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return (asUTC - date.getTime()) / 60000;
}

/** The calendar date in `tz` at this instant. */
export function tzParts(date, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, weekday: 'long',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map(x => [x.type, x.value]));
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour % 24, minute: +p.minute,
    weekday: DAYS.indexOf(p.weekday.toLowerCase()),
  };
}

/** A wall-clock time in `tz`, as a real instant. Two passes so DST lands right. */
export function zonedToInstant({ year, month, day, hour, minute }, tz) {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let inst = naive - tzOffsetMinutes(new Date(naive), tz) * 60000;
  inst = naive - tzOffsetMinutes(new Date(inst), tz) * 60000;
  return new Date(inst);
}

/**
 * Parse a lock string like "Thursday 7:15 PM CT" and return the next time it
 * comes round, at or after `now`. Returns null if the string is not parseable,
 * so a malformed config degrades to "no guard" rather than blowing up a send.
 */
export function nextLock(lockTime, now = new Date(), tz = 'America/Chicago') {
  const m = /^\s*(\w+)\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(String(lockTime || ''));
  if (!m) return null;
  const targetDay = DAYS.indexOf(m[1].toLowerCase());
  if (targetDay < 0) return null;
  let hour = Number(m[2]) % 12;
  if (/pm/i.test(m[4])) hour += 12;
  const minute = Number(m[3]);

  const here = tzParts(now, tz);
  // Check today first, then each following day, so "today at 7:15pm" wins while
  // it is still ahead of us and rolls to next week once it has passed.
  for (let add = 0; add <= 7; add++) {
    const probe = new Date(now.getTime() + add * 86400000);
    const d = tzParts(probe, tz);
    if (d.weekday !== targetDay) continue;
    const inst = zonedToInstant({ year: d.year, month: d.month, day: d.day, hour, minute }, tz);
    if (inst.getTime() >= now.getTime()) return inst;
  }
  return null;
}

/** "about 2 hours", "about 45 minutes", "under 10 minutes". */
export function untilPhrase(ms) {
  const mins = Math.round(ms / 60000);
  if (mins <= 0) return 'already locked';
  if (mins < 10) return 'under 10 minutes';
  if (mins < 75) return `about ${mins} minutes`;
  const hours = ms / 3600000;
  const rounded = hours < 4 ? Math.round(hours * 2) / 2 : Math.round(hours);
  const label = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  return `about ${label} hour${rounded === 1 ? '' : 's'}`;
}
