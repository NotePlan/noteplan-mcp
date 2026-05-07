#!/usr/bin/env bash
#
# Build the calendar-helper and reminders-helper Swift binaries.
#
# Configuration is read from `scripts/.env.build` (gitignored — copy
# `scripts/.env.build.example` and fill in your team's values). Without
# that file the script falls back to ad-hoc signing, which works locally
# but is blocked on managed Macs running strict Gatekeeper / Santa
# policies.
#
# When `NP_TEAM_ID` resolves to a real Developer ID cert in the login
# keychain the build assumes a release context: the notarytool credential
# profile referenced by `NP_NOTARIZE_PROFILE` MUST also exist, otherwise
# the build fails. This is deliberate — silently shipping a signed-but-
# not-notarized binary would still be blocked on managed Macs.
#
# Overrides (env vars take precedence over the .env.build file):
#   NP_TEAM_ID="…"            — Apple Team ID for cert auto-detection.
#   NP_SIGN_IDENTITY="…"      — full identity string, bypasses auto-detection.
#   NP_NOTARIZE_PROFILE="…"   — notarytool keychain-profile name.
#   NP_SKIP_NOTARIZE=1        — sign but skip notarization (for fast local
#                               release-style builds; do NOT publish).
#
# See BUILD.md for the full release flow.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Clean up notarization artifacts even if the script aborts midway
# (set -e will kill us on a non-zero notarytool exit before our own rm runs).
trap 'rm -f scripts/calendar-helper.zip scripts/reminders-helper.zip' EXIT

# Load local configuration if present. Real values live here (gitignored);
# the committed `.env.build.example` shows the expected keys. Loading runs
# in a subshell-safe way: only known NP_* vars get exported, any extra
# lines in the file are ignored to keep the script defensive against
# malformed configs.
if [[ -f scripts/.env.build ]]; then
  while IFS='=' read -r key value; do
    case "$key" in
      NP_TEAM_ID|NP_SIGN_IDENTITY|NP_NOTARIZE_PROFILE|NP_SKIP_NOTARIZE)
        # Only set if not already set in the shell environment.
        if [[ -z "${!key:-}" ]]; then
          export "$key=$value"
        fi
        ;;
    esac
  done < <(grep -v '^[[:space:]]*#' scripts/.env.build | grep -v '^[[:space:]]*$')
fi

TEAM_ID="${NP_TEAM_ID:-}"
SIGN_IDENTITY="${NP_SIGN_IDENTITY:-}"
NOTARIZE_PROFILE="${NP_NOTARIZE_PROFILE:-}"
SKIP_NOTARIZE="${NP_SKIP_NOTARIZE:-}"

SIGN_IDENTITY_LABEL=""
if [[ -n "$SIGN_IDENTITY" ]]; then
  SIGN_IDENTITY_LABEL="$SIGN_IDENTITY"
elif [[ -n "$TEAM_ID" ]]; then
  # security find-identity prints rows like
  #   1) <SHA1> "Developer ID Application: Foo (TEAMID)"
  # Use the SHA1 (always unambiguous) — the name can match multiple certs,
  # which makes codesign refuse with "ambiguous (matches X and X)".
  matching_row="$(security find-identity -v -p codesigning 2>/dev/null \
    | grep "Developer ID Application:.*(${TEAM_ID})" \
    | head -n 1 || true)"
  if [[ -n "$matching_row" ]]; then
    SIGN_IDENTITY="$(echo "$matching_row" | awk '{print $2}')"
    SIGN_IDENTITY_LABEL="$(echo "$matching_row" | sed -E 's/.*"(.+)".*/\1/')"
  fi
fi

# Decide whether we'll notarize. Only when we have a real signature AND
# a notarytool profile name to use AND the maintainer hasn't opted out.
NOTARIZE_ENABLED=""
if [[ -n "$SIGN_IDENTITY" && "$SKIP_NOTARIZE" != "1" ]]; then
  if [[ -z "$NOTARIZE_PROFILE" ]]; then
    cat >&2 <<EOM
[build-helpers] Found a Developer ID cert but no notarytool profile name.

Release builds require a notarization step. Set NP_NOTARIZE_PROFILE in
scripts/.env.build (copy scripts/.env.build.example and fill in your
values) — or re-run with NP_SKIP_NOTARIZE=1 to sign-only for a local
test build (do NOT publish the result).

See BUILD.md for the one-time setup.
EOM
    exit 1
  fi
  NOTARIZE_ENABLED="1"
  if ! xcrun notarytool history --keychain-profile "$NOTARIZE_PROFILE" >/dev/null 2>&1; then
    cat >&2 <<EOM
[build-helpers] Notarytool profile '${NOTARIZE_PROFILE}' not found in keychain.

Set up the profile once with:

  xcrun notarytool store-credentials ${NOTARIZE_PROFILE} \\
    --apple-id "<your-apple-id>" \\
    --team-id "${TEAM_ID:-<your-team-id>}" \\
    --password "<app-specific-password from appleid.apple.com>"

Or, to skip notarization for a quick local release-style build (do NOT
publish the result), re-run with NP_SKIP_NOTARIZE=1.

See BUILD.md for the full one-time setup.
EOM
    exit 1
  fi
fi

if [[ -n "$SIGN_IDENTITY" ]]; then
  echo "[build-helpers] Signing with: ${SIGN_IDENTITY_LABEL}"
else
  echo "[build-helpers] No Developer ID cert for team ${TEAM_ID} — ad-hoc signing."
  echo "[build-helpers] (Install the cert for a release build, or set NP_SIGN_IDENTITY.)"
fi
if [[ -n "$NOTARIZE_ENABLED" ]]; then
  echo "[build-helpers] Notarization profile: ${NOTARIZE_PROFILE}"
elif [[ -n "$SIGN_IDENTITY" && "$SKIP_NOTARIZE" == "1" ]]; then
  echo "[build-helpers] Notarization SKIPPED (NP_SKIP_NOTARIZE=1) — do not publish."
fi

build_helper() {
  local name="$1"
  local source="scripts/${name}.swift"
  local plist="scripts/${name}-Info.plist"
  local out="scripts/${name}"
  local arm="${out}-arm64"
  local x86="${out}-x86_64"

  echo "[build-helpers] Compiling ${name} (arm64 + x86_64)..."
  swiftc -target arm64-apple-macosx14.0 \
    -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$plist" \
    -o "$arm" "$source"
  swiftc -target x86_64-apple-macosx14.0 \
    -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$plist" \
    -o "$x86" "$source"

  lipo -create "$arm" "$x86" -output "$out"
  rm "$arm" "$x86"

  if [[ -n "$SIGN_IDENTITY" ]]; then
    # `--options runtime` enables hardened runtime (required by notarization).
    # `--timestamp` embeds a secure Apple timestamp (required by notarization).
    # `-f` overwrites any prior signature.
    codesign -f -s "$SIGN_IDENTITY" --options runtime --timestamp "$out"
  else
    codesign -s - "$out"
  fi

  codesign --verify --verbose=2 "$out" >/dev/null 2>&1
  echo "[build-helpers] Built ${out}"
}

notarize_helper() {
  local name="$1"
  local out="scripts/${name}"
  local zip="scripts/${name}.zip"

  echo "[build-helpers] Notarizing ${name}..."
  rm -f "$zip"
  ditto -c -k --keepParent "$out" "$zip"

  # `--wait` blocks until Apple finishes; output JSON so we can fail loudly
  # on rejection. Bare CLI binaries can't be stapled, but notarization
  # registers the ticket online — Gatekeeper picks it up on first run.
  local result
  result="$(xcrun notarytool submit "$zip" \
    --keychain-profile "$NOTARIZE_PROFILE" \
    --wait \
    --output-format json)"
  rm -f "$zip"

  local status
  status="$(echo "$result" | python3 -c "import sys, json; print(json.load(sys.stdin).get('status',''))")"
  if [[ "$status" != "Accepted" ]]; then
    echo "[build-helpers] Notarization FAILED for ${name}: status=${status}" >&2
    echo "$result" >&2
    exit 1
  fi
  echo "[build-helpers] Notarized ${name}"
}

build_helper calendar-helper
build_helper reminders-helper

if [[ -n "$NOTARIZE_ENABLED" ]]; then
  notarize_helper calendar-helper
  notarize_helper reminders-helper
fi

echo "[build-helpers] Done."
