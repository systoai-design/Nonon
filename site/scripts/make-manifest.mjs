// Builds latest.json from real installer files so size and sha256 are never typed by hand.
// Usage:
//   node scripts/make-manifest.mjs --version 0.1.0 \
//     --win "E:/path/NONON-0.1.0-win-x64.exe" [--win-signed] \
//     --mac "E:/path/NONON-0.1.0-mac-arm64.dmg" [--mac-notarized] \
//     [--date 2026-10-09T12:00:00Z] [--out latest.json]
import { createHash } from "node:crypto";
import { createReadStream, statSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    version: { type: "string" },
    win: { type: "string" },
    mac: { type: "string" },
    "win-signed": { type: "boolean", default: false },
    "mac-notarized": { type: "boolean", default: false },
    date: { type: "string" },
    out: { type: "string", default: "latest.json" },
  },
});

if (!values.version || !/^\d+\.\d+\.\d+$/.test(values.version)) {
  console.error("--version x.y.z is required");
  process.exit(1);
}
if (!values.win && !values.mac) {
  console.error("Give at least one of --win or --mac");
  process.exit(1);
}

function sha256(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

const files = [];
if (values.win) {
  const name = basename(values.win);
  files.push({
    platform: "windows",
    arch: "x64",
    name,
    size: statSync(values.win).size,
    sha256: await sha256(values.win),
    signed: values["win-signed"],
  });
}
if (values.mac) {
  const name = basename(values.mac);
  files.push({
    platform: "macos",
    arch: "arm64",
    name,
    size: statSync(values.mac).size,
    sha256: await sha256(values.mac),
    notarized: values["mac-notarized"],
  });
}

const manifest = { version: values.version, date: values.date ?? new Date().toISOString(), files };
writeFileSync(values.out, JSON.stringify(manifest, null, 2) + "\n");
console.log(`wrote ${values.out}`);
console.log(JSON.stringify(manifest, null, 2));
