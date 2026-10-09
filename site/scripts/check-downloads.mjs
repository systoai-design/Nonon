// Black-box check of /api/latest and /dl/* against a running Worker (local or deployed).
// Usage: node scripts/check-downloads.mjs http://127.0.0.1:8799
import { createHash } from "node:crypto";

const base = (process.argv[2] ?? "http://127.0.0.1:8799").replace(/\/$/, "");
let failures = 0;

function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
  if (!ok) failures++;
}

const latest = await (await fetch(`${base}/api/latest`)).json();
if (!latest.available) {
  check("manifest present", false, "api/latest says available:false; seed latest.json first");
  process.exit(1);
}
check("manifest present", true, `version ${latest.version}, ${latest.files.length} file(s)`);

for (const file of latest.files) {
  const url = base + file.url;
  const full = await fetch(url);
  const body = Buffer.from(await full.arrayBuffer());
  check(`${file.name}: 200 full`, full.status === 200 && body.length === file.size, `status ${full.status}, ${body.length} bytes`);
  check(`${file.name}: sha256 matches manifest`, createHash("sha256").update(body).digest("hex") === file.sha256);
  check(`${file.name}: attachment disposition`, full.headers.get("content-disposition") === `attachment; filename="${file.name}"`);
  check(`${file.name}: accept-ranges bytes`, full.headers.get("accept-ranges") === "bytes");
  check(`${file.name}: nosniff + CSP present`, full.headers.get("x-content-type-options") === "nosniff" && !!full.headers.get("content-security-policy"));
  const cache = full.headers.get("cache-control") ?? "";
  check(`${file.name}: cache-control`, cache.includes("must-revalidate") && !cache.includes("immutable"), cache);
  const etag = full.headers.get("etag");
  check(`${file.name}: etag`, !!etag, etag ?? "");

  const part = await fetch(url, { headers: { Range: "bytes=10-109" } });
  const partBody = Buffer.from(await part.arrayBuffer());
  check(`${file.name}: range 10-109 gives 206`, part.status === 206 && part.headers.get("content-range") === `bytes 10-109/${file.size}` && partBody.equals(body.subarray(10, 110)), `${part.status} ${part.headers.get("content-range")}`);

  const tail = await fetch(url, { headers: { Range: "bytes=-50" } });
  const tailBody = Buffer.from(await tail.arrayBuffer());
  check(`${file.name}: suffix range -50`, tail.status === 206 && tailBody.equals(body.subarray(body.length - 50)), `${tail.status} ${tail.headers.get("content-range")}`);

  const open = await fetch(url, { headers: { Range: `bytes=${file.size - 20}-` } });
  const openBody = Buffer.from(await open.arrayBuffer());
  check(`${file.name}: open-ended range`, open.status === 206 && openBody.equals(body.subarray(body.length - 20)), `${open.status} ${open.headers.get("content-range")}`);

  const past = await fetch(url, { headers: { Range: `bytes=${file.size + 5}-` } });
  check(`${file.name}: range past end gives 416`, past.status === 416 && past.headers.get("content-range") === `bytes */${file.size}`, `${past.status} ${past.headers.get("content-range")}`);

  const cond = await fetch(url, { headers: { "If-None-Match": etag ?? "" } });
  check(`${file.name}: If-None-Match gives 304`, cond.status === 304, String(cond.status));

  const head = await fetch(url, { method: "HEAD" });
  check(`${file.name}: HEAD`, head.status === 200 && head.headers.get("content-length") === String(file.size));
}

const missing = await fetch(`${base}/dl/NONON-0.0.0-win-x64.exe`);
check("missing file gives 404", missing.status === 404);
const manifestDirect = await fetch(`${base}/dl/latest.json`);
check("latest.json not served from /dl", manifestDirect.status === 404);
const badType = await fetch(`${base}/dl/notes.html`);
check("non-installer extension gives 404", badType.status === 404);
const traversal = await fetch(`${base}/dl/..%2Fsecret.exe`);
check("path traversal gives 404", traversal.status === 404, String(traversal.status));

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
