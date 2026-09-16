# Church League

Rotisserie standings, winnings and DFS analytics for a 17-team DraftKings weekly-contest league.
Replaces the `Church League Standings` spreadsheet.

**The whole weekly job is one command.**

```bash
./ingest.sh
```

That grabs the newest `contest-standings-*.csv` out of `~/Downloads`, works out the week number,
rebuilds the site, commits and pushes. GitHub Actions deploys and the site is live in about a minute.

---

## Each week, in order

1. On the DK contest's GameCenter page, click **Export Lineups to CSV**.
2. Run `./ingest.sh`. Add `--link <url>` to record that week's contest link at the same time.
3. Done. The emails send themselves on schedule.

```bash
./ingest.sh                                    # newest download, next unfilled week
./ingest.sh --week 5                           # force the week
./ingest.sh --link https://draftkings.com/...  # also record the contest link
./ingest.sh --dry                              # show what it would do, change nothing
./ingest.sh --no-push                           # build + commit locally, do not deploy
```

---

## The files you actually edit

| File | What it controls |
|---|---|
| `data/league.json` | Roster, real names, who has paid, playoff size, penalty rule |
| `data/emails.json` | The 17 addresses. **Gitignored** — never committed. Mirrored into the `LEAGUE_EMAILS` secret |
| `data/payouts.json` | Every dollar. The build **fails** if the allocation does not close on the pool |
| `data/overrides.json` | Commissioner rulings — late lineups, fines, manual scores |
| `data/contests.json` | Weekly DK contest links used by the emails |

Everything else is generated. `data/weeks/*.csv` are the raw DK exports, kept verbatim as the
permanent record.

---

## Scoring

Ported formula-for-formula from the retired workbook, then asserted against it:

```
weekly roto points = Excel RANK(score, all 17 scores, ascending)
                     high score gets 17, low gets 1, ties SHARE a rank
season rank        = RANK(cumulative roto, desc)
                     + count of teams tied on roto with more points-for
weeks 15-18        = every tally resets, and roto is ranked WITHIN each bracket
                     (7-team playoff pool maxes at 7/wk, 10-team Toilet Bowl at 10)
```

`node scripts/validate-engine.mjs` replays all 14 regular-season weeks of 2025-26 (23 teams,
322 roto computations) and asserts every total and final rank matches the spreadsheet's own
cells — including the 150/150, 158/158 and 137/137 points-for tiebreaks and the shared-rank
tie in Week 8. **This runs on every deploy.** If scoring ever drifts, the site does not ship.

### Ties

The spreadsheet's behavior is preserved exactly, which has one consequence worth knowing:
two teams tied for the weekly high both receive 16 roto points and nobody receives 17. That is
what Excel's `RANK` does and what every prior season used. A tied weekly high score splits
the $100.

---

## Missed lineups

DK will not accept an entry after kickoff, so a no-show never appears in the CSV at all.
The build detects that, counts the offense, and **defaults to the league-low score** while
flagging it on the site as needing a ruling. You then record what actually happened:

```jsonc
// data/overrides.json
{
  "2026": {
    "3": {
      "landoflakes": { "ruling": "late_lineup", "points": 121.4, "note": "1st offense, free pass" },
      "thom53":      { "ruling": "fine_paid",   "points": 140.2, "note": "paid the $25" }
    }
  }
}
```

| ruling | effect |
|---|---|
| `late_lineup` | Late lineup counts, no fine. Use for a 1st offense. Needs `points`. |
| `fine_paid` | Late lineup counts, $25 added to their ledger. Needs `points`. |
| `league_low` | Force the week's lowest score. Already the automatic default. |
| `score` | Set any score manually. Needs `points`. |

---

## Payouts — $4,250 across 17 teams

Derived from the 21-team/$5,250 structure. 43.75% of 17 = 7.44, so **7 make the Championship
bracket and 10 go to the Toilet Bowl**.

| Bucket | Total | Detail |
|---|---|---|
| Weekly high scorer | $1,400 | $100 × 14 weeks, ties split |
| Regular season | $1,400 | $650 / $375 / $235 / $140 |
| Championship playoffs | $1,200 | $650 / $345 / $205 |
| Toilet Bowl | $250 | Winner gets their buy-in back |

Weekly money is now **32.9%** of the pot, up from 26.7% at 21 teams, because $100/week is held
constant against a smaller pool. To restore the old proportions, drop `weekly.amount` to `81`
and move the difference into the season buckets — it is one number in `data/payouts.json`, and
the build will tell you if the math stops closing.

---

## Emails

Sent from your Gmail by GitHub Actions. **Lineups lock Thursday 7:15 PM CT**, and every
reminder sits safely ahead of that.

| When | Email | Central now (CDT) | After 1 Nov (CST) |
|---|---|---|---|
| **on ingest** | `standings` — results, recap, next contest | whenever you run `./ingest.sh` | same |
| Tue 14:00 UTC | `standings` *backstop only* | Tue 9:00 AM | Tue 8:00 AM |
| Wed 22:00 UTC | `reminder` — locks tomorrow | Wed 5:00 PM | Wed 4:00 PM |
| Thu 14:00 UTC | `reminder` — locks tonight | Thu 9:00 AM | Thu 8:00 AM |
| Thu 22:00 UTC | `reminder` — last call, ~2h out | Thu 5:00 PM | Thu 4:00 PM |

Plus `launch`, a one-time announcement that the site exists, carrying the rescaled payout table.

**Cron is UTC and has no concept of daylight saving**, so the Central times above shift an hour
earlier when DST ends on 1 November 2026 — around Week 9. Every send stays hours ahead of lock
either way, so this is left alone rather than papered over with duplicate crons.

**The standings email is event-driven, not scheduled.** It goes out when a week's CSV is
ingested, whatever time of day that is, because a morning-only cron would silently miss an
afternoon ingest — the cron would have already run and would not fire again for a week. The
Tuesday cron remains as a backstop for a Monday-night ingest. `--once` stops the two doubling up.

Reminder de-duplication is keyed by **slot** (`wed-pm`, `thu-am`, `thu-pm`), not by date, because
two of the three reminders share a UTC date. The slot also sets the urgency: "locks tomorrow",
"locks tonight", "last call".

`lockTime` lives in `data/league.json`. Irregular weeks exist — Week 1 opened Wednesday,
Thanksgiving and Christmas shift, and Week 18 has no Thursday game — so change it if a week
differs.

Everyone is **Cc'd**, not Bcc'd, so Reply All reaches the whole league and the trash talk stays public. This does mean all 17 addresses are visible to all 17 members, which is the intent.

### One-time setup

1. Create a Gmail **App Password** at <https://myaccount.google.com/apppasswords>
   (needs 2FA on the account). This is not your Google password and can be revoked anytime.
2. Store it — you paste it, it never appears in this repo or in any transcript:

```bash
gh secret set GMAIL_APP_PASSWORD
gh secret set GMAIL_USER --body "kylebahrautomation@gmail.com"
gh variable set SITE_URL --body "https://kylebahr.github.io/church-league"
```

`GMAIL_USER` must be the account the app password was generated on. Mail is sent
from that account and `Reply-To` points at `commissioner.email` in
`data/league.json`, so replies reach a real inbox rather than the automation one.
The sending account is excluded from the recipient list; every other address in
`LEAGUE_EMAILS` is Cc'd, including the commissioner's own.

3. Addresses live in `data/emails.json` (gitignored) and the `LEAGUE_EMAILS` secret, never in git.

Nothing sends until both secrets exist, so a half-finished setup is a no-op rather than a mistake.
`--once` records every send in `data/email-log.json`, so nothing sends twice: `launch` once per
season, `standings` once per week, and each `reminder` once per slot per week.

### Test before trusting it

```bash
node scripts/email.mjs launch    --dry                    # writes out/email-launch.html
node scripts/email.mjs standings --dry
node scripts/email.mjs reminder  --dry --slot thu-pm      # slot tunes the urgency
node scripts/email.mjs standings --to you@example.com     # real send, only to you
```

Or run the **League emails** workflow manually from the Actions tab with *dry run* checked.

---

## Automating the ingest

The weekly job can be reduced to one action: click **Export Lineups to CSV** on the DK contest
page. `scripts/install-watcher.sh` installs a launchd agent that watches `~/Downloads` and runs
`./ingest.sh --unattended` the moment a contest export lands.

```bash
./scripts/install-watcher.sh              # install (watches ./inbox)
./scripts/install-watcher.sh --status     # is it working?
./scripts/install-watcher.sh --uninstall  # remove
./scripts/install-watcher.sh --watch DIR  # watch somewhere else
```

Save the DK export into **`inbox/`** and everything else happens on its own. Once ingested, the
file is filed into `inbox/processed/`, so whatever is sitting loose in `inbox/` is whatever has
not been handled yet.

Unattended mode is deliberately paranoid, because a false positive would both score wrong data
and email 17 people:

1. filename must match `contest-standings-*.csv` and be less than 12 hours old
2. file size must stop changing (a download arrives in pieces)
3. content sha must not already exist under `data/weeks/`
4. at least 70% of the roster must appear in the export, or it is ignored
5. it will never overwrite a week that is already ingested

### Why this repo lives at `~/church-league` and not under `~/Documents`

macOS guards exactly three folders — **Desktop, Documents and Downloads**. A launchd agent gets no
access to them and is denied *silently*: the only symptom is `Operation not permitted` in the log.
The agent looked healthy and did nothing.

Rather than grant Full Disk Access to `/bin/bash` — a broad permission covering every script on the
machine — the repo and its drop folder sit outside all three, where no permission is required at
all. `--status` still detects a TCC denial and explains it, in case this ever moves back.

### Why the download itself is not automated

DraftKings has no usable path for it, and the ways around that are worse than the problem:

- `GET /contest/exportfullstandingscsv?contestId=…` **302s to the login page.** It needs a
  logged-in session.
- `api.draftkings.com` returns **403 from Akamai** to any non-browser request.
- Each week is a *new* contest with a new id, so the id has to be discovered from the league page,
  which is also behind auth.

Getting past that means storing DK session cookies that expire constantly, and defeating bot
detection on a gambling site where the account holds real money and 17 people depend on it. The
failure mode is not "the script breaks", it is "the account gets flagged mid-season". Clicking
Export is two seconds and carries none of that risk.

---

## Local development

```bash
node scripts/build.mjs                 # build into site/
node scripts/validate-engine.mjs       # assert scoring against the old spreadsheet
python3 -m http.server 4173 --directory site
```

No dependencies. No build step beyond Node itself. Nothing to `npm install`, which is the
point — this needs to still work in December.

---

## What is on the site

- **Standings** — roto race chart, full table with the playoff cut line drawn in, bubble watch,
  auto-written weekly recap, movers
- **Weeks** — the roto grid and raw-points grid from the spreadsheet, plus every weekly winner
  and payout; one page per week with every lineup, the best possible lineup from the league's
  player pool, leverage plays, busts and solo starts
- **Money** — full ledger with banked vs projected winnings and net position against the $250
  buy-in, pool accounting, and the payout structure with its derivation
- **Players** — season ownership, leverage board, hall of busts, and a chalk index ranking who
  plays the field and who plays the crowd

Pick your team once from any **Spotlight your team** dropdown and your row is highlighted
everywhere, stored locally in your own browser.

The site is `noindex` and unlisted: anyone with the link can read it, search engines cannot
find it.
