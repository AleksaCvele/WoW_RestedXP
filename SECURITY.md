# Security

## Official downloads

Only download WoW Rested Tracker and the RestedSync addon from:

* this repository's **Releases** page, and
* the project's own addon page (e.g. CurseForge), if one is listed in the README.

Each release includes `SHA256SUMS.txt`. To check a download on Windows (PowerShell):

```powershell
Get-FileHash .\WoW-Rested-Tracker_1.0.0_x64-setup.exe -Algorithm SHA256
```

The hash must match the line for that file in `SHA256SUMS.txt`. Copies from anywhere
else (re-uploads, "modded" versions, Discord attachments) are not ours.

## What the software can access

| Part | Access |
| --- | --- |
| RestedSync addon | Runs inside WoW's addon sandbox. Reads your character's level, XP, rested XP and inn status through Blizzard's API and saves them to its own SavedVariables file. No network, no file access, no slash commands. |
| Desktop widget | Reads only the `RestedSync.lua` files and portrait images **you picked** (or that auto-detection found under `WTF\Account\…\SavedVariables`). The allow-list is kept by the app's backend, so the user interface can't widen it. Stores its settings in its own config folder. |
| Network | No telemetry, no accounts. It only goes online to check this repository for signed updates (if enabled), to open links you click, and to load portrait image links you type in. |

Updates are signed with a private key that never leaves the maintainer's GitHub
secrets. The app verifies every update against the public key built into it and
refuses anything that doesn't match.

## Reporting a vulnerability

Please **don't** open a public issue for security problems. Use GitHub's private
reporting instead: **Security** tab → **Report a vulnerability**. You should get a
reply within a week. Please include steps to reproduce and the version you tested.

## Supported versions

Only the latest release gets security fixes. With auto-update on (the default),
installed copies pick up fixes on their own.
