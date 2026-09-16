// Regression test: replay the retired 2025-26 workbook through the new engine
// and assert the rotisserie totals and final ranks come out identical.
// Run with: node scripts/validate-engine.mjs
import fs from 'node:fs';
import { rankAsc, rankDesc } from './lib/engine.mjs';

const hist = JSON.parse(fs.readFileSync('data/history/2025-26.json', 'utf8'));

// Expected values read straight out of the workbook's own cells.
const EXPECTED_ROTO = {
  Zste2311: 242, bearsconner67: 236, Annihilus: 230, MKE_AL: 227, thom53: 222,
  SHEENING61: 211, GreenWeezy: 195, askfarwell: 185, 'bill.reineking': 174,
  urfullofBS23: 173, Thawki01: 170, Yolander: 158, Bobby_the_Butcher: 158,
  Marauder94: 155, HaHa2108: 150, Scheele: 150, mfox90: 140, earnhoelter: 137,
  Paulclemens: 137, SwampDawgs: 136, SaquenDeezNuts: 121, seansum: 87,
  mikeschuett86: 68,
};
const EXPECTED_RANK = {
  Zste2311: 1, bearsconner67: 2, Annihilus: 3, MKE_AL: 4, thom53: 5, SHEENING61: 6,
  GreenWeezy: 7, askfarwell: 8, 'bill.reineking': 9, urfullofBS23: 10, Thawki01: 11,
  Yolander: 12, Bobby_the_Butcher: 13, Marauder94: 14, HaHa2108: 15, Scheele: 16,
  mfox90: 17, earnhoelter: 18, Paulclemens: 19, SwampDawgs: 20, SaquenDeezNuts: 21,
  seansum: 22, mikeschuett86: 23,
};
// Weeks 1-14 only, matching the workbook's "Total" column.
const REG = 14;

const teams = Object.keys(hist.weeklyPoints);
const roto = Object.fromEntries(teams.map(t => [t, 0]));
const pointsFor = Object.fromEntries(teams.map(t => [t, 0]));

for (let w = 0; w < REG; w++) {
  const scores = teams.map(t => hist.weeklyPoints[t][w] ?? 0);
  for (const t of teams) {
    const s = hist.weeklyPoints[t][w] ?? 0;
    roto[t] += rankAsc(s, scores);
    pointsFor[t] += s;
  }
}

const rotos = teams.map(t => roto[t]);
const rank = {};
for (const t of teams) {
  rank[t] = rankDesc(roto[t], rotos)
    + teams.filter(x => roto[x] === roto[t] && pointsFor[x] > pointsFor[t]).length;
}

let fails = 0;
console.log('team                  roto  exp   rank  exp');
console.log('-'.repeat(48));
for (const t of teams.sort((a, b) => rank[a] - rank[b])) {
  const rOk = roto[t] === EXPECTED_ROTO[t];
  const kOk = rank[t] === EXPECTED_RANK[t];
  if (!rOk || !kOk) fails++;
  console.log(
    `${t.padEnd(20)} ${String(roto[t]).padStart(5)} ${String(EXPECTED_ROTO[t]).padStart(4)}` +
    ` ${String(rank[t]).padStart(6)} ${String(EXPECTED_RANK[t]).padStart(4)}` +
    `  ${rOk && kOk ? 'ok' : 'MISMATCH'}`
  );
}
console.log('-'.repeat(48));
if (fails) {
  console.error(`\nFAIL: ${fails} team(s) diverge from the workbook.`);
  process.exit(1);
}
console.log(`\nPASS: all ${teams.length} teams match the retired workbook exactly`);
console.log('(14 weeks x 23 teams = 322 roto computations, including the 150/150 and 158/158');
console.log(' and 137/137 points-for tiebreaks and the shared-rank tie at week 8.)');
