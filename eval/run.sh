#!/usr/bin/env bash
# A/B evaluation for pi-plate against a local model.
#
#   RUNS=5 ./eval/run.sh
#
# Two prompt variants (a: grounding irrelevant, b: copyright year needed) crossed
# with two arms (grounded: extension installed, control: uninstalled). The extension
# is toggled with `pi install .` / `pi uninstall .`, so both arms run pi in its
# normal configuration and differ only by pi-plate. Settings are restored on exit,
# including on interrupt.
#
# Requires a running llama.cpp server. Wipes ~/Code/playground between runs.
set -uo pipefail

EXT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLAY="$HOME/Code/playground"
OUT="$EXT/eval/results"
RUNS="${RUNS:-5}"

restore() {
  echo "restoring pi-plate to installed state..."
  (cd "$EXT" && pi install . >/dev/null 2>&1)
}
trap restore EXIT INT TERM

mkdir -p "$OUT/sessions"

for variant in a b; do
  for arm in grounded control; do
    if [ "$arm" = "grounded" ]; then
      (cd "$EXT" && pi install . >/dev/null 2>&1)
    else
      (cd "$EXT" && pi uninstall . >/dev/null 2>&1)
    fi

    for i in $(seq 1 "$RUNS"); do
      id="${variant}-${arm}-${i}"
      rm -rf "$PLAY" && mkdir -p "$PLAY"
      sess="$OUT/sessions/$id"
      rm -rf "$sess" && mkdir -p "$sess"

      start=$(date +%s)
      (cd "$PLAY" && pi -p --session-dir "$sess" "$(cat "$EXT/eval/prompt-$variant.txt")") \
        >"$OUT/$id.stdout" 2>"$OUT/$id.stderr"
      code=$?
      elapsed=$(($(date +%s) - start))

      node "$EXT/eval/score.mjs" "$id" "$variant" "$arm" "$PLAY" "$sess" "$code" "$elapsed" \
        >"$OUT/$id.json"
      passed=$(node -e "process.stdout.write(String(require('$OUT/$id.json').taskPassed))")
      echo "$id  ${elapsed}s  exit=$code  pass=$passed"
    done
  done
done

echo "all runs complete -> $OUT"
