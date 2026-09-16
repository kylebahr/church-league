#!/usr/bin/env bash
# Installs (or removes) the launchd agent that watches ~/Downloads and ingests
# a DraftKings contest export the moment it lands.
#
#   ./scripts/install-watcher.sh            # install and start
#   ./scripts/install-watcher.sh --status   # is it loaded?
#   ./scripts/install-watcher.sh --uninstall
#
# After this, the entire weekly job is: click "Export Lineups to CSV" on DK.

set -euo pipefail

LABEL="com.kylebahr.churchleague.ingest"

# NB: never `launchctl list | grep -q` under pipefail - grep -q exits on the
# first match, launchctl takes SIGPIPE, and the pipeline reports failure on
# success. grep -c reads all of its input, so it cannot misfire that way.
is_loaded() {
  local n
  n="$(launchctl list 2>/dev/null | grep -c "$LABEL" || true)"
  [[ "${n:-0}" -gt 0 ]]
}

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/church-league.log"

case "${1:-install}" in
  --status)
    if is_loaded; then
      echo "loaded:   yes"
      launchctl list "$LABEL" 2>/dev/null | grep -E '"(PID|LastExitStatus)"' | sed 's/^/  /' || true
    else
      echo "loaded:   no"
    fi
    echo "plist:    $PLIST $([[ -f $PLIST ]] && echo '(present)' || echo '(missing)')"
    echo "log:      $LOG"
    # macOS TCC denies a launchd agent access to ~/Downloads and ~/Documents
    # with no prompt. That shows up only as "Operation not permitted" in the
    # log, so surface it loudly instead of looking healthy while doing nothing.
    if [[ -f "$LOG" ]] && grep -q "Operation not permitted" "$LOG" 2>/dev/null; then
      echo
      echo "BLOCKED BY MACOS PRIVACY (TCC)."
      echo "  The agent runs but cannot read ~/Downloads or write this repo."
      echo "  Fix it one of these ways:"
      echo "   1. System Settings > Privacy & Security > Full Disk Access,"
      echo "      add /bin/bash. Broad permission - understand what you are granting."
      echo "   2. Move the repo and Chrome's download folder somewhere unprotected"
      echo "      (e.g. ~/church-league), which needs no permission at all."
      echo "   3. Skip the watcher and keep running ./ingest.sh yourself."
    fi
    [[ -f "$LOG" ]] && { echo "--- last 10 log lines ---"; tail -10 "$LOG" | sed 's/^/  /'; }
    exit 0
    ;;
  --uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Watcher removed. ./ingest.sh still works by hand."
    exit 0
    ;;
esac

mkdir -p "$HOME/Library/LaunchAgents" "$(dirname "$LOG")"

# Capture the node that works in YOUR shell and pin it into the agent. Do not
# let launchd's bare PATH pick one: /usr/local/bin/node on this machine is
# v10.15.2 and cannot run this code.
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "node is not on your PATH, so the watcher would have nothing to run." >&2
  exit 1
fi
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 18 )); then
  echo "node at $NODE_BIN is v$("$NODE_BIN" -v | tr -d v) - this needs 18 or newer." >&2
  exit 1
fi
echo "pinning node: $NODE_BIN ($("$NODE_BIN" -v))"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO/scripts/watch-ingest.sh</string>
  </array>

  <!-- Fires whenever ~/Downloads changes. The script exits immediately when
       the change is not a DraftKings contest export. -->
  <key>WatchPaths</key>
  <array><string>$HOME/Downloads</string></array>

  <!-- Also sweep hourly, so a download that landed while the agent was not
       running (Mac asleep, just-rebooted) still gets picked up. -->
  <key>StartInterval</key><integer>3600</integer>

  <key>EnvironmentVariables</key>
  <dict>
    <key>CL_NODE</key><string>$NODE_BIN</string>
  </dict>

  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
PLIST_EOF

plutil -lint "$PLIST" >/dev/null || { echo "generated plist is malformed" >&2; exit 1; }

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
# bootstrap is the modern call and load the legacy one; on some macOS setups
# bootstrap returns I/O error while load still registers the agent, so try both
# and then VERIFY rather than trusting either exit code.
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl load "$PLIST" 2>/dev/null || true

if ! is_loaded; then
  echo >&2
  echo "FAILED: the agent did not register with launchd." >&2
  echo "  plist: $PLIST" >&2
  echo "  try:   launchctl bootstrap gui/$(id -u) \"$PLIST\"" >&2
  echo "  (./ingest.sh by hand is unaffected.)" >&2
  exit 1
fi

echo "Watcher installed and registered with launchd."
echo
echo "  watches : $HOME/Downloads for contest-standings-*.csv"
echo "  runs    : $REPO/ingest.sh --unattended"
echo "  log     : $LOG"
echo
echo "Your weekly job is now: click \"Export Lineups to CSV\" on the DK contest page."
echo "Everything after that - scoring, site, deploy, league email - is automatic."
echo
echo "  ./scripts/install-watcher.sh --status     check on it"
echo "  ./scripts/install-watcher.sh --uninstall  remove it"
