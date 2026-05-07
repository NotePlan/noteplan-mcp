# Building and Releasing

This repo ships two native Swift helper binaries — `scripts/calendar-helper` and `scripts/reminders-helper` — that the MCP server invokes as a fallback when AppleScript-via-NotePlan isn't available. The default build ad-hoc signs them, which is fine for local development but is rejected by Gatekeeper / Santa on managed corporate Macs. Releases must be signed with a Developer ID certificate and notarized.

## Local development build

```bash
npm run build
```

If `scripts/.env.build` is missing or empty, the build falls back to ad-hoc signing. Ad-hoc helpers work locally but are blocked on managed Macs — never publish them.

## Release build (signed + notarized)

### One-time setup (per maintainer)

1. **Copy the env template and fill in your team's values:**
   ```bash
   cp scripts/.env.build.example scripts/.env.build
   $EDITOR scripts/.env.build
   ```
   You need:
   - `NP_TEAM_ID` — your Apple Developer Team ID. Find it via `security find-identity -v -p codesigning | grep "Developer ID Application"` (the ID in parentheses) or in the Apple Developer membership page.
   - `NP_NOTARIZE_PROFILE` — the name you'll give the notarytool keychain profile in step 3 (e.g. `MyCompany-Notary`).

   `scripts/.env.build` is gitignored. The committed `.example` file shows the keys without any company-specific values.

2. **Confirm the Developer ID Application certificate is in your login keychain.** If Xcode signs your macOS app on this machine, you already have it. Verify:
   ```bash
   security find-identity -v -p codesigning | grep "$NP_TEAM_ID"
   ```
   You should see at least one `Developer ID Application: … (<team-id>)` row.

3. **Create an app-specific password for `notarytool`.** Apple requires this — your regular Apple ID password won't authenticate against the notarization API.
   - Go to [appleid.apple.com](https://appleid.apple.com) → **Sign-In and Security → App-Specific Passwords → +**.
   - Label it `notarytool` and copy the generated password (Apple shows it only once).

4. **Store the credentials in your keychain** so the build script never sees them in plaintext:
   ```bash
   xcrun notarytool store-credentials "$NP_NOTARIZE_PROFILE" \
     --apple-id "<your-apple-id-email>" \
     --team-id "$NP_TEAM_ID" \
     --password "<app-specific-password>"
   ```

5. **Verify the credentials work** (should print recent submissions or an empty list, not an auth error):
   ```bash
   xcrun notarytool history --keychain-profile "$NP_NOTARIZE_PROFILE"
   ```

### Building a release

Once the one-time setup is done, just build:

```bash
npm run build
```

The build script reads `scripts/.env.build`, finds your Developer ID certificate by team ID, signs both binaries with hardened runtime + secure timestamp, then submits each to Apple for notarization and waits for the result. Notarization typically completes in 1–3 minutes; the build fails loudly if Apple rejects or if the notarytool profile isn't set up.

To skip notarization for a quick local release-style build (do NOT publish the result):

```bash
NP_SKIP_NOTARIZE=1 npm run build
```

Other ad-hoc overrides (env vars take precedence over `.env.build`):

```bash
NP_SIGN_IDENTITY="Developer ID Application: …" npm run build   # bypass cert auto-detection
NP_NOTARIZE_PROFILE="alt-profile" npm run build                # use a different notarytool profile
```

### Verifying the build

```bash
codesign --display --verbose=4 scripts/calendar-helper
codesign --display --verbose=4 scripts/reminders-helper
```

Both should report `Signature=Developer ID …` (not `Signature=adhoc`), `Timestamp=…`, and `Runtime Version=…`. To verify Gatekeeper accepts the binary as notarized:

```bash
spctl -a -vv -t install scripts/calendar-helper
```

Should print `accepted, source=Notarized Developer ID`.

### Publishing

```bash
npm publish
```

`prepublishOnly` runs the build and a preflight that refuses to publish if either binary is still ad-hoc signed. To produce an unsigned tarball locally for inspection (e.g. `npm pack`), set `NP_ALLOW_ADHOC=1` to bypass the guard — but never `npm publish` with it set.

## Troubleshooting

- **`xcrun: error: unable to find utility "notarytool"`** — Update Command Line Tools or Xcode (`sudo xcode-select --install` and ensure `xcode-select -p` points at a recent enough Xcode/Developer dir).
- **Notarization rejected with "The signature does not include a secure timestamp"** — Either `NP_TEAM_ID` doesn't match an installed cert (build fell back to ad-hoc) or you set `NP_SIGN_IDENTITY` to an ad-hoc value. Check the build log; it prints which mode it's in.
- **Notarization rejected with "The executable does not have the hardened runtime enabled"** — The build script always passes `--options runtime` when signing with a real identity. If you see this, you probably ran an old build script manually; re-run `npm run build`.
- **`codesign: ambiguous (matches X and X)`** — You have multiple Developer ID certs with the same name in the keychain (e.g. one expired, one current). The script handles this automatically by signing with the SHA-1 of the first matching cert. If it still happens, override with `NP_SIGN_IDENTITY="<sha1>"` to pick the exact one (`security find-identity -v -p codesigning` lists them).
- **`codesign: object file format unrecognized`** — Confirm the Swift compile produced a fat binary: `lipo -info scripts/calendar-helper` should list both `arm64` and `x86_64`.
- **Notarized binary still blocked on a managed Mac** — Bare CLI binaries can't be stapled (only bundles can). Notarization registers the ticket online, so first-run Gatekeeper check requires network connectivity. Confirm the user's machine can reach Apple's notarization servers.
