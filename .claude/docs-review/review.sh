#!/usr/bin/env bash
# Docs review. When main gets new commits, ask Claude (headless, read-only) whether the documentation and the things
# that tend to get forgotten now need updating, and leave the answer in reports/docs-review/latest.md.
#
#   review.sh                    started by .git/hooks/post-commit and .git/hooks/post-merge; does nothing off main
#   review.sh --once BASE HEAD   review one range now, print the report, touch no state (for trying it out)
#
# What it reads: checklist.md and prompt.md next to this file. What it keeps: the last reviewed commit and a lock in
# <git dir>/docs-review, so a burst of commits is reviewed once, as one range, and nothing is reviewed twice.
# The scripts are tracked; the reports (reports/, kept out of git) and the hooks that start it (.git/hooks) are local.
# To install, make .git/hooks/post-commit and .git/hooks/post-merge start this script in the background.
set -u

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
quiet=${DOCS_REVIEW_QUIET_SECONDS:-45}   # wait this long after a commit, so a run of commits becomes one review

run_review() { # base head: the report on stdout; non-zero when Claude could not produce one
  local base=$1 head=$2 prompt rc dir
  dir=$(cygpath -m "$here" 2>/dev/null || echo "$here")   # a Windows path: Claude's Read tool cannot open /m/...
  prompt=$(mktemp)
  { cat "$here/prompt.md"; printf '\nChecklist: %s\nRange: %s..%s\n' "$dir/checklist.md" "$base" "$head"; } > "$prompt"
  "${DOCS_REVIEW_CLAUDE:-claude}" -p --model sonnet --no-session-persistence --strict-mcp-config --disable-slash-commands \
    --setting-sources project,local --max-budget-usd 3 --add-dir "$dir" \
    --tools Read,Grep,Glob,Bash \
    --allowedTools Read Grep Glob "Bash(git log:*)" "Bash(git diff:*)" "Bash(git show:*)" "Bash(git ls-files:*)" \
      "Bash(git blame:*)" "Bash(git rev-list:*)" \
    < "$prompt"
  rc=$?
  rm -f "$prompt"
  return $rc
}

# A report starts with its VERDICT line. Claude can exit 0 with an error message instead (an expired login does), so
# the output is only a report if it says so.
is_report() { head -n 3 "$1" | grep -q '^VERDICT: '; }

notify() { # title body: a Windows toast; silent when there is no PowerShell
  command -v powershell.exe >/dev/null 2>&1 || return 0
  DR_TITLE=$1 DR_BODY=$2 powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command '
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    $x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
    $t = $x.GetElementsByTagName("text")
    $t.Item(0).AppendChild($x.CreateTextNode($env:DR_TITLE)) | Out-Null
    $t.Item(1).AppendChild($x.CreateTextNode($env:DR_BODY)) | Out-Null
    $id = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe"
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id).Show([Windows.UI.Notifications.ToastNotification]::new($x))
  ' >/dev/null 2>&1 || true
}

if [ "${1:-}" = "--once" ]; then
  run_review "$2" "$3"
  exit $?
fi

[ -n "${FLOWY_DOCS_REVIEW:-}" ] && exit 0   # a review never starts a review
export FLOWY_DOCS_REVIEW=1

unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$root" || exit 0
on_main() { [ "$(git symbolic-ref --short -q HEAD)" = main ]; }
on_main || exit 0

state=$(cd "$(git rev-parse --git-common-dir)" && pwd)/docs-review
mkdir -p "$state"
if ! mkdir "$state/lock" 2>/dev/null; then
  # Someone is reviewing and will pick up this commit when it loops. A lock older than 30 minutes is a crash.
  [ -n "$(find "$state/lock" -maxdepth 0 -mmin +30 2>/dev/null)" ] || exit 0
  rm -rf "$state/lock"; mkdir "$state/lock" || exit 0
fi
trap 'rm -rf "$state/lock"' EXIT

# Settings that run code must never come from a commit: a tracked .claude/settings.json (hooks) or .mcp.json (servers) would
# be loaded by the headless run below with no trust prompt. Neither is tracked on purpose, so a tracked one is something to
# look at. CLAUDE.md and .claude/ui-text.md are tracked; the run reads them, and its tools are read-only git commands.
tracked=$(git ls-files -- .claude/settings.json .claude/settings.local.json .mcp.json 2>/dev/null | head -n 3)
if [ -n "$tracked" ]; then
  echo "$(date '+%F %T') REFUSED: git tracks agent config ($tracked)" >> "$state/log"
  notify "Docs review stopped" "git tracks agent config: $(echo $tracked). Look at where it came from before the next review."
  exit 0
fi

out="$root/reports/docs-review"
mkdir -p "$out"

while :; do
  sleep "$quiet"
  on_main || break
  head=$(git rev-parse HEAD)
  last=$(cat "$state/last" 2>/dev/null || true)
  if [ -z "$last" ]; then last=$(git rev-parse "$head~1" 2>/dev/null) || { echo "$head" > "$state/last"; break; }; fi   # first run: this commit
  [ "$last" = "$head" ] && break

  if git merge-base --is-ancestor "$last" "$head" 2>/dev/null; then base=$last
  else base=$(git merge-base "$last" "$head" 2>/dev/null || git rev-parse "$head~1"); fi

  # Docs-only ranges have nothing to go stale.
  if ! git diff --name-only "$base" "$head" | grep -qvE '^(README\.md|CONTRIBUTING\.md|docs/|flowy/)'; then
    echo "$head" > "$state/last"; continue
  fi

  short=$(git rev-parse --short "$head")
  report="$out/$(date +%Y-%m-%d-%H%M)-$short.md"
  if ! run_review "$base" "$head" > "$report.partial" 2> "$state/last-error.log" || ! is_report "$report.partial"; then
    head -c 2000 "$report.partial" >> "$state/last-error.log"; rm -f "$report.partial"
    echo "$(date '+%F %T') FAILED $base..$head: $(head -n 1 "$state/last-error.log")" >> "$state/log"
    if grep -qi 'authenticate' "$state/last-error.log"; then
      notify "Docs review can't sign in" "main at $short was not reviewed. Run: claude auth login"
    else
      notify "Docs review failed" "main at $short was not reviewed. See .git/docs-review/last-error.log"
    fi
    break
  fi
  mv "$report.partial" "$report"
  cp "$report" "$out/latest.md"
  echo "$head" > "$state/last"

  verdict=$(grep -m1 '^VERDICT:' "$report" || echo 'VERDICT: UNKNOWN')
  echo "$(date '+%F %T') $base..$head $verdict" >> "$state/log"
  case "$verdict" in
    *CLEAN*) ;;
    *) notify "Docs review: ${verdict#VERDICT: }" "main at $short. Read reports/docs-review/latest.md" ;;
  esac
done
