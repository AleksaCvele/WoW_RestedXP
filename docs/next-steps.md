# Next steps (maintainer checklist)

Where things stand: the app, addon, auto-update, CI and security hardening are done and
on GitHub. These are the remaining steps to ship it publicly, in order.

## 1. Local setup (Windows)

```powershell
mkdir C:\repos -Force
cd C:\repos
git clone https://github.com/AleksaCvele/WoW_RestedXP.git
cd WoW_RestedXP
npm install
npm run tauri dev
```

Needs Git, Node.js 22+, Rust (rustup) and the "Desktop development with C++" build tools
(`winget install Microsoft.VisualStudio.BuildTools --override "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"`).

Windows 11 **Smart App Control** blocks Cargo's unsigned build scripts (os error 4551), so
`npm run tauri dev` only works with it turned off (Windows Security → App & browser
control → Smart App Control settings).

## 2. Update-signing key → GitHub secrets ✅

* Repository → Settings → Secrets and variables → Actions:
  `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
* Keep a copy of both in a password manager. Never commit them (`.gitignore` blocks `*.key`).

## 3. Clean up the branch ✅

* Default branch renamed from `ccr-d0cb1aad-i0pyy6` to `main`. Existing clones:
  `git branch -m ccr-d0cb1aad-i0pyy6 main && git fetch origin --prune && git branch -u origin/main main && git remote set-head origin -a`.
* Dependabot PRs: `@types/node` 26 closed (ignored on purpose), GitHub Actions group and
  `base64` 0.23 merged, the separate `setup-node` 7 PR closed as a duplicate.
  Still open: `notify` 9. It builds in CI, but the watcher isn't covered by tests, so
  merge it only after checking logout detection in the running app.
* `actions/download-artifact` 8 is only used by the tag-only release job, so it's first
  exercised by the v1.0.0 tag in step 6.

## 4. GitHub settings ✅

* Account: two-factor authentication ON ✅
* Settings → Code security: Dependabot alerts + security updates, secret scanning + push
  protection, private vulnerability reporting ✅
* Ruleset "Protect main": no deletion, no force pushes, changes via pull request, `test` and
  `windows` checks required; admins can bypass (so `git push origin main` still works) ✅
  Docs-only PRs skip the Build workflow, so their required checks never report: merge
  those with the admin bypass.
* **Still open:** Repository → Settings → Actions → General → "Allow actions created by
  GitHub" only (currently "Allow all actions").

## 5. Go public ✅

* `PATREON_URL` set in `src/config.ts`.
* Repository is public.

## 6. First releases + auto-update test

1. `git tag v1.0.0 && git push origin v1.0.0` → CI builds a draft release → Publish.
2. Install v1.0.0 on Windows.
3. `npm run version:set 1.0.1`, commit, tag `v1.0.1`, push, publish.
4. The installed app should update itself within ~6 hours (or Settings → Updates → Check now).

## 7. Free Windows code signing (SignPath Foundation)

Free for open-source projects; it removes the "unknown publisher" part of the SmartScreen
warning over time, and lets the installer run on PCs with Smart App Control on (unsigned
builds are blocked there with no "Run anyway").

Requirements (signpath.org/terms) and where the project stands:

* OSI license, no proprietary components: MIT ✓
* Already released in the form to be signed: **apply after v1.0.0 is published** (step 6).
* Code signing policy on the home page and release pages: README
  [Code signing policy](../README.md#code-signing-policy) ✓, linked from the release notes ✓.
  Remove the "Status: applying" note once signing is live.
* Privacy statement that covers the update check ✓ (same section).
* Functionality documented, uninstall instructions (README → Install the widget) ✓
* Built from source on CI (GitHub-hosted runners) ✓; product name and version in the file
  metadata come from `tauri.conf.json` ✓
* MFA for every team member on GitHub ✓ and on the SignPath account (set it up there).
* Every signing request is approved by hand in SignPath.

Apply at <https://signpath.org/apply>.

Once accepted, integrating it into `build.yml`:

* SignPath's GitHub action (`signpath/github-action-submit-signing-request`) is a
  third-party action: allow exactly that action, pinned to a commit SHA, in the Actions
  settings, and update the "only GitHub's own actions" line in README → Security.
* Authenticode signing changes the installer bytes, so the auto-update signature
  (`*.sig`) must be created **after** SignPath signs the `.exe`/`.msi`
  (`npx tauri signer sign <file>`), otherwise updates fail verification.

## 8. Optional

* Publish the addon on CurseForge (free): upload `RestedSync-<version>.zip`.
* macOS: unsigned builds work via right-click → Open; notarization needs a paid Apple
  developer account (skip unless needed).
