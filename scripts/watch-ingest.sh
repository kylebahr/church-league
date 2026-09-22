#!/usr/bin/env bash
# Fires when ~/Downloads changes. Finds a fresh DraftKings contest export,
# ingests it, and lets the normal pipeline take over: build -> commit -> push
# -> deploy -> standings email to the league.
#
# launchd calls this on every single change in ~/Downloads, so it has to be
# cheap and silent when there is nothing to do. It also has to be paranoid:
# a false positive here scores the wrong data AND emails 17 people.
#
# Guards, in order:
#   1. filename must look like a DK contest export
#   2. file must be settled (size stable) - downloads arrive in pieces
#   3. content must not already be present under data/weeks/ (sha compare)
#   4. ./ingest.sh --unattended re-checks the roster and refuses to overwrite
#
# Install with scripts/install-watcher.sh. Log: ~/Library/Logs/church-league.log

set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
WATCH="${CL_WATCH_DIR:-$REPO/inbox}"
LOG="$HOME/Library/Logs/church-league.log"
LOCKDIR="/tmp/church-league-ingest.lock.d"

mkdir -p "$(dirname "$LOG")"
log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; }
notify() {
  [[ -n "${CL_NO_NOTIFY:-}" ]] && return 0   # set by tests, so they stay silent
  command -v osascript >/dev/null 2>&1 || return 0
  osascript -e "display notification \"$1\" with title \"Church League\"" >/dev/null 2>&1 || true
}

# Only one run at a time: launchd fires in bursts. mkdir is atomic and, unlike
# flock, actually exists on macOS - flock here silently failed and made the
# whole script a no-op.
if ! mkdir "$LOCKDIR" 2>/dev/null; then
  # A lock older than 10 minutes is a crashed run, not a live one.
  if [[ -n "$(find "$LOCKDIR" -maxdepth 0 -mmin +10 2>/dev/null)" ]]; then
    rmdir "$LOCKDIR" 2>/dev/null || true
    mkdir "$LOCKDIR" 2>/dev/null || exit 0
  else
    exit 0
  fi
fi
trap 'rmdir "$LOCKDIR" 2>/dev/null || true' EXIT

cd "$REPO" || exit 0

# --- 0. finish any push a previous run could not complete -------------------
# A failed push leaves a week committed here but not on GitHub. Nothing below
# would ever notice, because step 3 sees the week's sha already in data/weeks/
# and treats it as done. Left alone, one network blip strands a week forever
# with no error anyone would see. So every run first checks for unpushed work.
sync_unpushed() {
  git fetch -q origin main 2>/dev/null || return 0
  local ahead
  ahead="$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)"
  [[ "$ahead" -gt 0 ]] || return 0
  log "found $ahead unpushed commit(s) - syncing"
  if git pull --rebase -q origin main 2>>"$LOG" && git push -q origin main 2>>"$LOG"; then
    log "OK: synced unpushed work to GitHub"
    notify "A previously stuck ingest has been pushed. Site is deploying."
  else
    git rebase --abort 2>/dev/null || true
    log "FAILED to sync unpushed work; will retry next run"
  fi
}
sync_unpushed

# --- 1. is there a candidate at all? ----------------------------------------
CAND="$(ls -t "$WATCH"/contest-standings-*.csv 2>/dev/null | head -1)"
[[ -n "$CAND" ]] || exit 0

# Ignore anything older than 12 hours; this script runs on every download and
# must not keep re-examining a file from weeks ago.
if [[ -z "$(find "$CAND" -mmin -720 2>/dev/null)" ]]; then exit 0; fi

# --- 2. wait for the download to settle -------------------------------------
size_of() { wc -c < "$1" 2>/dev/null | tr -d ' '; }
prev="$(size_of "$CAND")"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  cur="$(size_of "$CAND")"
  [[ "$cur" == "$prev" && "${cur:-0}" -gt 0 ]] && break
  prev="$cur"
done
[[ "${cur:-0}" -gt 0 ]] || exit 0

# --- 3. already ingested? ----------------------------------------------------
sha="$(shasum -a 256 "$CAND" | awk '{print $1}')"
for f in data/weeks/*.csv; do
  [[ -e "$f" ]] || continue
  if [[ "$(shasum -a 256 "$f" | awk '{print $1}')" == "$sha" ]]; then
    # Already ingested. File it away so inbox/ only shows genuinely pending work.
    if [[ "$(dirname "$CAND")" == "$WATCH" ]]; then
      mkdir -p "$WATCH/processed" && mv "$CAND" "$WATCH/processed/" 2>/dev/null \
        && log "filed duplicate of $(basename "$f"): $(basename "$CAND")"
    fi
    exit 0
  fi
done

log "new export detected: $(basename "$CAND") ($cur bytes)"

# --- 4. find a USABLE node --------------------------------------------------
# launchd gives a minimal PATH, so node has to be located explicitly. Guessing
# is not safe: this Mac has v10.15.2 at /usr/local/bin/node, which cannot do
# dynamic import() and fails every ingest with "Not supported". install-watcher
# bakes the right binary into the plist as CL_NODE; everything else is fallback,
# and whatever is chosen must prove its major version.
node_major() { "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null; }

NODE=""
for cand in \
  "${CL_NODE:-}" \
  "$(command -v node 2>/dev/null)" \
  /opt/homebrew/bin/node \
  "$HOME"/.nvm/versions/node/*/bin/node \
  /usr/local/bin/node
do
  [[ -n "$cand" && -x "$cand" ]] || continue
  maj="$(node_major "$cand")"
  [[ -n "$maj" ]] || continue
  if [[ "$maj" -ge 18 ]]; then NODE="$cand"; break; fi
done

if [[ -z "$NODE" ]]; then
  log "FAILED: no node >= 18 found (CL_NODE='${CL_NODE:-unset}')"
  notify "Ingest failed: usable Node not found. See the log."
  exit 1
fi
export PATH="$(dirname "$NODE"):$PATH"
log "using node $("$NODE" -v) at $NODE"

out="$(./ingest.sh --unattended "$CAND" 2>&1)"
rc=$?
printf '%s\n' "$out" >> "$LOG"

case $rc in
  0)
    week="$(printf '%s' "$out" | sed -n 's/.*Committed week \([0-9]*\).*/\1/p' | tail -1)"
    # File the export away so the drop folder shows only what is pending.
    if mkdir -p "$WATCH/processed" 2>/dev/null; then
      mv "$CAND" "$WATCH/processed/$(basename "$CAND")" 2>/dev/null \
        && log "filed: processed/$(basename "$CAND")"
    fi
    log "OK: ingested${week:+ week $week}"
    notify "Week ${week:-?} ingested. Site is deploying and the league email is on its way."
    ;;
  3) log "skipped: week already ingested" ;;
  6) log "committed locally but push failed; will retry next run"
     notify "Week ingested but not yet pushed. Will retry automatically." ;;
  4) log "skipped: not this league's contest" ;;
  *)
    log "FAILED (exit $rc)"
    notify "Ingest failed. Open ~/Library/Logs/church-league.log"
    ;;
esac
exit 0
