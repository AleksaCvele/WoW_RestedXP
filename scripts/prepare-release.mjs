// Collects the CI build outputs into release-out/: installers with URL-safe names,
// latest.json for the auto-updater (only if update signatures exist) and SHA256SUMS.txt.
//
//   node scripts/prepare-release.mjs <artifacts-dir> <out-dir> <tag>
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const [inDir, outDir, tag] = process.argv.slice(2);
if (!inDir || !outDir || !tag) {
  console.error("usage: prepare-release.mjs <artifacts-dir> <out-dir> <tag>");
  process.exit(2);
}

const version = tag.replace(/^v/, "");
const appVersion = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version;
if (appVersion !== version) {
  // Otherwise installed apps would see a "new" version forever and keep reinstalling it.
  console.error(`Tag ${tag} does not match the app version ${appVersion} in src-tauri/tauri.conf.json.`);
  console.error("Run `npm run version:set <version>`, commit, and tag again.");
  process.exit(1);
}

const repo = process.env.GITHUB_REPOSITORY ?? "OWNER/REPO";
const downloadBase = `https://github.com/${repo}/releases/download/${tag}/`;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

mkdirSync(outDir, { recursive: true });
const assets = [];
for (const file of walk(inDir)) {
  if (file.endsWith(".sig")) continue;
  const name = basename(file).replace(/\s+/g, "-");
  copyFileSync(file, join(outDir, name));
  assets.push({ source: file, name });
}

const platforms = {};
for (const { source, name } of assets) {
  const sigFile = `${source}.sig`;
  if (!existsSync(sigFile)) continue;
  const entry = { signature: readFileSync(sigFile, "utf8").trim(), url: downloadBase + encodeURIComponent(name) };
  if (name.endsWith("-setup.exe")) {
    platforms["windows-x86_64-nsis"] = entry;
    platforms["windows-x86_64"] = entry; // NSIS is the default Windows installer
  } else if (name.endsWith(".msi")) {
    platforms["windows-x86_64-msi"] = entry;
  } else if (name.endsWith(".app.tar.gz")) {
    for (const arch of ["darwin-aarch64", "darwin-x86_64"]) {
      platforms[arch] = entry; // universal binary
      platforms[`${arch}-app`] = entry;
    }
  }
}

if (Object.keys(platforms).length > 0) {
  const latest = {
    version,
    notes: `See https://github.com/${repo}/releases/tag/${tag}`,
    pub_date: new Date().toISOString(),
    platforms,
  };
  writeFileSync(join(outDir, "latest.json"), JSON.stringify(latest, null, 2) + "\n");
  console.log(`latest.json: ${Object.keys(platforms).join(", ")}`);
} else {
  console.warn("No update signatures found: latest.json not created (installed apps won't auto-update to this release).");
}

const sums = readdirSync(outDir)
  .filter((n) => n !== "SHA256SUMS.txt")
  .sort()
  .map((n) => `${createHash("sha256").update(readFileSync(join(outDir, n))).digest("hex")}  ${n}`);
writeFileSync(join(outDir, "SHA256SUMS.txt"), sums.join("\n") + "\n");
console.log(sums.join("\n"));
