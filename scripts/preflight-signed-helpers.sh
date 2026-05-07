#!/usr/bin/env bash
#
# Pre-publish guard: refuse to ship calendar-helper / reminders-helper
# binaries that are still ad-hoc signed. Runs from `prepublishOnly` so
# `npm publish` fails loudly if the maintainer forgot to fill in
# scripts/.env.build before building.
#
# Skip with `NP_ALLOW_ADHOC=1` for ad-hoc dry-runs (e.g. `npm pack`
# locally to inspect the tarball).

set -euo pipefail

if [[ "${NP_ALLOW_ADHOC:-}" == "1" ]]; then
  echo "[preflight] NP_ALLOW_ADHOC=1 set — skipping signature check."
  exit 0
fi

check_signed() {
  local binary="$1"
  if [[ ! -f "$binary" ]]; then
    echo "[preflight] Missing binary: $binary (run \`npm run build\` first)" >&2
    exit 1
  fi
  # `codesign -d -v` writes its summary to stderr.
  local info
  info="$(codesign -d -v "$binary" 2>&1)"
  if echo "$info" | grep -q "Signature=adhoc"; then
    cat >&2 <<EOM
[preflight] $binary is ad-hoc signed — refusing to publish.

Configure scripts/.env.build (copy scripts/.env.build.example) so the
build script can sign + notarize with your Developer ID, then re-run:

  npm run build
  npm publish

See BUILD.md for the full release flow.
EOM
    exit 1
  fi
  echo "[preflight] $binary is properly signed."
}

check_signed scripts/calendar-helper
check_signed scripts/reminders-helper
echo "[preflight] OK — helpers are signed for distribution."
