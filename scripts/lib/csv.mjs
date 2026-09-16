// RFC4180 CSV parser + DraftKings contest-standings export reader.

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* ignore */ }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

const SLOTS = ['DST', 'FLEX', 'QB', 'RB', 'TE', 'WR'];
const SLOT_RE = new RegExp(
  `\\b(${SLOTS.join('|')})\\s+(.+?)(?=\\s+\\b(?:${SLOTS.join('|')})\\b\\s|$)`, 'g'
);

/** "DST Jets  FLEX D'Andre Swift QB Lamar Jackson ..." -> [{slot, player}] */
export function parseLineup(raw) {
  if (!raw) return [];
  const out = [];
  for (const m of raw.matchAll(SLOT_RE)) out.push({ slot: m[1], player: m[2].trim() });
  return out;
}

/**
 * A DK export holds two tables side by side in one file:
 *   Rank,EntryId,EntryName,TimeRemaining,Points,Lineup | (blank) | Player,Roster Position,%Drafted,FPTS
 * The two have different row counts, so each is read independently and blanks skipped.
 */
export function parseContestStandings(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('empty CSV');
  const header = rows[0].map(h => h.trim());
  const idx = n => header.findIndex(h => h.toLowerCase() === n.toLowerCase());
  const cRank = idx('Rank'), cId = idx('EntryId'), cEntry = idx('EntryName'),
        cTime = idx('TimeRemaining'), cPts = idx('Points'), cLineup = idx('Lineup'),
        cPlayer = idx('Player'), cPos = idx('Roster Position'),
        cDraft = idx('%Drafted'), cFpts = idx('FPTS');
  if (cEntry < 0 || cPts < 0) {
    throw new Error(`Unrecognized DK export. Header was: ${header.join(',')}`);
  }

  const entries = [], players = [];
  for (const r of rows.slice(1)) {
    const name = (r[cEntry] ?? '').trim();
    if (name) entries.push({
      rank: num(r[cRank]), entryId: (r[cId] ?? '').trim(), username: name,
      timeRemaining: num(r[cTime]), points: num(r[cPts]),
      lineup: parseLineup(r[cLineup] ?? ''),
    });
    const p = cPlayer >= 0 ? (r[cPlayer] ?? '').trim() : '';
    if (p) players.push({
      player: p, slot: (r[cPos] ?? '').trim(),
      drafted: pct(r[cDraft]), fpts: num(r[cFpts]),
    });
  }
  if (!entries.length) throw new Error('DK export contained no entries');
  return { entries, players };
}

function num(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function pct(v) {
  const n = num(String(v ?? '').replace('%', ''));
  return n === null ? null : n / 100;
}
