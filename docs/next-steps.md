# Next steps (maintainer checklist)

Where things stand: the app, addon, auto-update, CI and security hardening are done and
on GitHub. These are the remaining steps to ship it publicly, in order.

## 1. Local setup (Windows)

```powershell
mkdir C:\repos -Force
cd C:\repos
git clone https://github.com/AleksaCvele/WoW_RestedXP.git
cd WoW_RestedXP
git checkout ccr-d0cb1aad-i0pyy6
npm install
npm run tauri dev
```

Needs Git, Node.js 22+, Rust (rustup) and the "Desktop development with C++" build tools.

## 2. Update-signing key → GitHub secrets

* Repository → Settings → Secrets and variables → Actions:
  `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
* Keep a copy of both in a password manager. Never commit them (`.gitignore` blocks `*.key`).

## 3. Clean up the branch

* Rename `ccr-d0cb1aad-i0pyy6` to `main` (GitHub → Settings → Branches / default branch),
  then locally: `git branch -m main && git fetch origin && git branch -u origin/main main`.
* Triage the open Dependabot PRs: close `@types/node` 26 (ignored on purpose), leave
  `notify` 9 until the watcher is updated for its API, merge GitHub Actions bumps once green.

## 4. GitHub settings

* Account: two-factor authentication ON (Settings → Password and authentication).
* Repository → Settings → Actions → General → "Allow actions created by GitHub" only.
* Settings → Code security: Dependabot alerts, secret scanning, private vulnerability reporting.
* Branch protection on `main`: require the Build workflow to pass, no force pushes.

## 5. Go public

* Set `PATREON_URL` in `src/config.ts`.
* Make the repository public (Settings → General → Danger zone). Auto-update and free
  code signing both need this. History contains no secrets (checked).

## 6. First releases + auto-update test

1. `git tag v1.0.0 && git push origin v1.0.0` → CI builds a draft release → Publish.
2. Install v1.0.0 on Windows.
3. `npm run version:set 1.0.1`, commit, tag `v1.0.1`, push, publish.
4. The installed app should update itself within ~6 hours (or Settings → Updates → Check now).

## 7. Free Windows code signing (SignPath Foundation)

Free for open-source projects; it removes the "unknown publisher" part of the SmartScreen
warning over time. Apply at signpath.org after the repo is public. Typical requirements:
OSI license (MIT ✓), public repository with releases, MFA for maintainers, builds on
GitHub-hosted runners (✓), and a "Code signing policy" section in the README. Each
release is approved manually in SignPath.

Integration note: Authenticode signing changes the installer bytes, so the auto-update
signature (`*.sig`) must be created **after** SignPath signs the `.exe`/`.msi`
(`npx tauri signer sign <file>`), otherwise updates fail verification.

## 8. Optional

* Publish the addon on CurseForge (free): upload `RestedSync-<version>.zip`.
* macOS: unsigned builds work via right-click → Open; notarization needs a paid Apple
  developer account (skip unless needed).
