#!/usr/bin/env bash
# Weekly ingest. This is the only command you run.
#
#   ./ingest.sh                          # grab the newest DK export from ~/Downloads
#   ./ingest.sh ~/Downloads/foo.csv      # use a specific file
#   ./ingest.sh --week 3                 # force the week number
#   ./ingest.sh --link https://...       # record this week's contest link
#   ./ingest.sh --no-push                # build and commit locally, do not deploy
#   ./ingest.sh --dry                    # show what would happen, change nothing
#
# It figures out the week number, copies the CSV into data/weeks/, rebuilds the
# site, commits, and pushes. GitHub Actions deploys and the site is live in ~60s.

set -euo pipefail
cd "$(dirname "$0")"

CSV=""; WEEK=""; LINK=""; PUSH=1; DRY=0; UNATTENDED=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --week)       WEEK="$2"; shift 2 ;;
    --link)       LINK="$2"; shift 2 ;;
    --no-push)    PUSH=0; shift ;;
    --dry)        DRY=1; shift ;;
    --unattended) UNATTENDED=1; shift ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)        echo "unknown flag: $1" >&2; exit 1 ;;
    *)         CSV="$1"; shift ;;
  esac
done

SEASON=$(node -e "console.log(require('./data/league.json').season)")

# --- find the CSV -----------------------------------------------------------
if [[ -z "$CSV" ]]; then
  CSV=$(ls -t "$HOME"/Downloads/contest-standings-*.csv 2>/dev/null | head -1 || true)
  if [[ -z "$CSV" ]]; then
    echo "No contest-standings-*.csv found in ~/Downloads."
    echo "Download it from the DK contest page (GameCenter -> Export Lineups to CSV),"
    echo "or pass the path: ./ingest.sh /path/to/file.csv"
    exit 1
  fi
  echo "Using newest export: $CSV"
fi
[[ -f "$CSV" ]] || { echo "No such file: $CSV" >&2; exit 1; }

# --- sanity-check it before it touches the repo ------------------------------
node -e "
  const fs=require('fs');
  import('./scripts/lib/csv.mjs').then(m=>{
    const d=m.parseContestStandings(fs.readFileSync(process.argv[1],'utf8'));
    const roster=require('./data/league.json').members.map(x=>x.username.toLowerCase());
    const unknown=d.entries.filter(e=>!roster.includes(e.username.toLowerCase())).map(e=>e.username);
    console.log('  entries: '+d.entries.length+'  players: '+d.players.length);
    if(unknown.length) console.log('  NOT ON ROSTER: '+unknown.join(', '));
    if(d.entries.length===0) process.exit(1);
  }).catch(e=>{ console.error('  CSV rejected: '+e.message); process.exit(1); });
" "$CSV"

# --- decide the week --------------------------------------------------------
if [[ -z "$WEEK" ]]; then
  WEEK=$(node -e "
    const fs=require('fs');
    const dir='data/weeks';
    const have=new Set(fs.existsSync(dir)?fs.readdirSync(dir).map(f=>{
      const m=f.match(/^${SEASON}-w(\d{1,2})\.csv$/i); return m?Number(m[1]):null;
    }).filter(Boolean):[]);
    for(let w=1;w<=18;w++) if(!have.has(w)) { console.log(w); break; }
  ")
  echo "Next unfilled week: $WEEK"
fi
[[ "$WEEK" =~ ^[0-9]+$ ]] || { echo "Bad week number: $WEEK" >&2; exit 1; }

DEST=$(printf "data/weeks/%s-w%02d.csv" "$SEASON" "$WEEK")
if [[ -f "$DEST" && $DRY -eq 0 ]]; then
  if [[ $UNATTENDED -eq 1 ]]; then
    # Never silently replace a week that already scored and already emailed.
    echo "Week $WEEK already ingested. Refusing to overwrite unattended."
    exit 3
  fi
  read -r -p "$DEST already exists. Overwrite week $WEEK? [y/N] " ok
  [[ "$ok" == "y" || "$ok" == "Y" ]] || { echo "Aborted."; exit 1; }
fi

# Unattended runs must not act on a file that is not this league's contest -
# ingesting the wrong CSV would score it AND email 17 people. Require most of
# the roster to appear in the export before touching anything.
if [[ $UNATTENDED -eq 1 ]]; then
  node -e "
    const fs=require('fs');
    import('./scripts/lib/csv.mjs').then(m=>{
      const d=m.parseContestStandings(fs.readFileSync(process.argv[1],'utf8'));
      const roster=require('./data/league.json').members.map(x=>x.username.toLowerCase());
      const names=d.entries.map(e=>e.username.toLowerCase());
      const hit=roster.filter(u=>names.includes(u)).length;
      const need=Math.ceil(roster.length*0.7);
      console.log('  roster match: '+hit+' of '+roster.length+' (need '+need+')');
      if(hit<need){ console.error('  Not this league\'s contest. Ignoring.'); process.exit(4); }
    }).catch(e=>{ console.error('  '+e.message); process.exit(4); });
  " "$CSV" || exit 4
fi

if [[ $DRY -eq 1 ]]; then
  echo
  echo "DRY RUN"
  echo "  would copy : $CSV"
  echo "            -> $DEST"
  [[ -n "$LINK" ]] && echo "  would record contest link for week $WEEK"
  echo "  would rebuild, commit$([[ $PUSH -eq 1 ]] && echo ' and push')"
  exit 0
fi

cp "$CSV" "$DEST"
echo "Copied -> $DEST"

# --- record the contest link ------------------------------------------------
if [[ -n "$LINK" ]]; then
  node -e "
    const fs=require('fs');
    const p='data/contests.json';
    const j=JSON.parse(fs.readFileSync(p,'utf8'));
    j['$SEASON']=j['$SEASON']||{};
    j['$SEASON']['$WEEK']='$LINK';
    fs.writeFileSync(p, JSON.stringify(j,null,2)+'\n');
  "
  echo "Recorded contest link for week $WEEK"
fi

# --- build ------------------------------------------------------------------
node scripts/build.mjs

# --- commit + deploy --------------------------------------------------------
if [[ ! -d .git ]]; then
  echo
  echo "Not a git repo yet, so nothing was pushed. The site is built in site/."
  exit 0
fi

git add -A
if git diff --cached --quiet; then
  echo "Nothing changed, so nothing to commit."
  exit 0
fi
git commit -q -m "Week $WEEK results

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
echo "Committed week $WEEK"

if [[ $PUSH -eq 1 ]]; then
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  git push -q origin "$BRANCH"
  echo "Pushed. GitHub Actions is deploying - the site is live in about a minute."
else
  echo "Skipped push (--no-push)."
fi
