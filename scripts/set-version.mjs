// Sets the desktop app version everywhere it lives:
//   npm run version:set 1.1.0
// (package.json, package-lock.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock)
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
  console.error("usage: npm run version:set <major.minor.patch>");
  process.exit(2);
}

function edit(file, fn) {
  const before = readFileSync(file, "utf8");
  const after = fn(before);
  if (after === before) throw new Error(`No version found to update in ${file}`);
  writeFileSync(file, after);
  console.log(`updated ${file}`);
}

const setJsonVersion = (text) => text.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`);
edit("package.json", setJsonVersion);
edit("src-tauri/tauri.conf.json", setJsonVersion);
edit("package-lock.json", (text) => {
  const lock = JSON.parse(text);
  lock.version = version;
  if (lock.packages?.[""]) lock.packages[""].version = version;
  return JSON.stringify(lock, null, 2) + "\n";
});
edit("src-tauri/Cargo.toml", (text) => text.replace(/(\[package\][^[]*?\nversion = ")[^"]+(")/, `$1${version}$2`));
edit("src-tauri/Cargo.lock", (text) =>
  text.replace(/(name = "wow-rested-tracker"\nversion = ")[^"]+(")/, `$1${version}$2`),
);
console.log(`\nNext: commit, then tag and push:  git tag v${version} && git push origin v${version}`);
