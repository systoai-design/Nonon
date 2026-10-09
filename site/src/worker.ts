const APEX_HOST = "trynonon.xyz";
const WWW_HOST = "www.trynonon.xyz";
const MANIFEST_KEY = "latest.json";

// No inline script or style anywhere on the site, so the policy can stay this strict.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CSP,
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

// Only installer-type files are served from the bucket; anything else 404s.
const DOWNLOAD_TYPES: Record<string, string> = {
  exe: "application/vnd.microsoft.portable-executable",
  dmg: "application/x-apple-diskimage",
  zip: "application/zip",
  blockmap: "application/octet-stream",
  yml: "text/yaml; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
// A semantic version in the name means the bytes never change, so they can be cached forever.

interface ManifestFile {
  platform: "windows" | "macos";
  arch: string;
  name: string;
  size: number;
  sha256: string;
  signed?: boolean;
  notarized?: boolean;
}

interface Manifest {
  version: string;
  date: string;
  files: ManifestFile[];
  notes?: string;
}

function json(body: unknown, status = 200, cacheControl = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl,
    },
  });
}

function text(body: string, status: number, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}

function withSecurityHeaders(response: Response): Response {
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!out.headers.has(name)) out.headers.set(name, value);
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The manifest is hand-uploaded by the maintainer, so check it like any outside input.
function parseManifest(raw: unknown): Manifest | null {
  if (!isRecord(raw)) return null;
  const { version, date, files, notes } = raw;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(version)) return null;
  if (typeof date !== "string" || Number.isNaN(Date.parse(date))) return null;
  if (!Array.isArray(files)) return null;

  const valid: ManifestFile[] = [];
  for (const entry of files) {
    if (!isRecord(entry)) continue;
    const { platform, arch, name, size, sha256, signed, notarized } = entry;
    if (platform !== "windows" && platform !== "macos") continue;
    if (typeof arch !== "string" || !/^[a-z0-9_]{2,16}$/.test(arch)) continue;
    if (typeof name !== "string" || !SAFE_FILE_NAME.test(name) || !fileType(name)) continue;
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) continue;
    if (typeof sha256 !== "string" || !/^[0-9a-fA-F]{64}$/.test(sha256)) continue;
    const file: ManifestFile = { platform, arch, name, size, sha256: sha256.toLowerCase() };
    if (typeof signed === "boolean") file.signed = signed;
    if (typeof notarized === "boolean") file.notarized = notarized;
    valid.push(file);
  }
  if (valid.length === 0) return null;
  const manifest: Manifest = { version, date, files: valid };
  if (typeof notes === "string" && notes.length <= 500) manifest.notes = notes;
  return manifest;
}

function fileType(name: string): string | undefined {
  const dot = name.lastIndexOf(".");
  if (dot < 1) return undefined;
  return DOWNLOAD_TYPES[name.slice(dot + 1).toLowerCase()];
}

async function handleLatest(env: Env): Promise<Response> {
  const object = await env.DOWNLOADS.get(MANIFEST_KEY);
  if (!object) return json({ available: false }, 200, "public, max-age=30");
  let manifest: Manifest | null = null;
  try {
    manifest = parseManifest(await object.json());
  } catch {
    manifest = null;
  }
  if (!manifest) return json({ available: false }, 200, "public, max-age=30");
  const files = manifest.files.map((file) => ({ ...file, url: `/dl/${file.name}` }));
  return json({ available: true, ...manifest, files }, 200, "public, max-age=60");
}

function contentRange(range: R2Range, size: number): { start: number; length: number } {
  if ("suffix" in range) {
    const length = Math.min(range.suffix, size);
    return { start: size - length, length };
  }
  const start = Math.min(range.offset ?? 0, size);
  const length = Math.min(range.length ?? size - start, size - start);
  return { start, length };
}

function downloadHeaders(object: R2Object, name: string, contentType: string): Headers {
  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("Content-Disposition", `attachment; filename="${name}"`);
  headers.set("Accept-Ranges", "bytes");
  headers.set("ETag", object.httpEtag);
  headers.set("Last-Modified", object.uploaded.toUTCString());
  headers.set(
    "Cache-Control",
    "public, max-age=300, must-revalidate", // Installers keep the same file name when a build is replaced, so they must never be cached as unchanging.
  );
  return headers;
}

// One "bytes=a-b", "bytes=a-" or "bytes=-n" range. Anything else (multi-range, junk) is ignored
// and the whole file is sent, which HTTP allows.
function parseRange(header: string | null): R2Range | null {
  const match = header ? /^bytes=([0-9]*)-([0-9]*)$/.exec(header.trim()) : null;
  if (!match) return null;
  const [, first = "", last = ""] = match;
  if (first === "" && last === "") return null;
  if (first === "") return { suffix: Number(last) };
  const offset = Number(first);
  if (last === "") return { offset };
  const end = Number(last);
  return end < offset ? null : { offset, length: end - offset + 1 };
}

async function handleDownload(request: Request, env: Env, name: string): Promise<Response> {
  const contentType = fileType(name);
  if (!SAFE_FILE_NAME.test(name) || !contentType) return text("Not found", 404);

  if (request.method === "HEAD") {
    const head = await env.DOWNLOADS.head(name);
    if (!head) return text("Not found", 404);
    const headers = downloadHeaders(head, name, contentType);
    headers.set("Content-Length", String(head.size));
    return new Response(null, { status: 200, headers });
  }

  let range = parseRange(request.headers.get("Range"));
  const ifRange = request.headers.get("If-Range");
  if (range && ifRange) {
    // A stale validator means the client's partial copy is outdated: send the whole file.
    const head = await env.DOWNLOADS.head(name);
    if (!head) return text("Not found", 404);
    if (ifRange !== head.httpEtag) range = null;
  }

  let object: R2ObjectBody | R2Object | null;
  try {
    object = await env.DOWNLOADS.get(name, { onlyIf: request.headers, ...(range ? { range } : {}) });
  } catch {
    // R2 rejects a range that starts past the end of the object.
    const head = await env.DOWNLOADS.head(name);
    if (!head) return text("Not found", 404);
    return text("Range not satisfiable", 416, { "Content-Range": `bytes */${head.size}` });
  }
  if (!object) return text("Not found", 404);

  const headers = downloadHeaders(object, name, contentType);

  if (!("body" in object)) {
    const failedIfMatch = request.headers.has("If-Match") || request.headers.has("If-Unmodified-Since");
    return new Response(null, { status: failedIfMatch ? 412 : 304, headers });
  }

  if (range) {
    const { start, length } = contentRange(range, object.size);
    if (length <= 0) {
      return text("Range not satisfiable", 416, { "Content-Range": `bytes */${object.size}` });
    }
    headers.set("Content-Range", `bytes ${start}-${start + length - 1}/${object.size}`);
    headers.set("Content-Length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}

// Files are not content-hashed, so keep the lifetime short enough that an edit shows up the same day.
function assetCacheControl(pathname: string): string | null {
  if (pathname.startsWith("/fonts/") || pathname.startsWith("/vendor/")) return "public, max-age=2592000";
  if (pathname.startsWith("/img/") || pathname.startsWith("/brand/")) return "public, max-age=86400";
  if (pathname.startsWith("/assets/")) return "public, max-age=3600, must-revalidate";
  if (
    ["/favicon.svg", "/favicon.ico", "/favicon-32.png", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/og.png"].includes(
      pathname,
    )
  ) {
    return "public, max-age=86400";
  }
  return null;
}

async function serveAsset(request: Request, env: Env): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  if (response.status === 200) {
    const cacheControl = assetCacheControl(new URL(request.url).pathname);
    if (!cacheControl) return response;
    const cached = new Response(response.body, response);
    cached.headers.set("Cache-Control", cacheControl);
    return cached;
  }
  if (response.status !== 404) return response;
  const page = await env.ASSETS.fetch(new Request(new URL("/404", request.url), { headers: request.headers }));
  return new Response(request.method === "HEAD" ? null : page.body, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.hostname === WWW_HOST) {
    return Response.redirect(`https://${APEX_HOST}${url.pathname}${url.search}`, 301);
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return text("Method not allowed", 405, { Allow: "GET, HEAD" });
  }

  if (url.pathname === "/api/latest") return handleLatest(env);
  if (url.pathname.startsWith("/api/")) return json({ error: "not_found" }, 404);

  if (url.pathname.startsWith("/dl/")) {
    const name = url.pathname.slice("/dl/".length);
    if (name === MANIFEST_KEY) return text("Not found", 404);
    return handleDownload(request, env, name);
  }

  return serveAsset(request, env);
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return withSecurityHeaders(await route(request, env));
    } catch (error) {
      console.error(JSON.stringify({ event: "worker_error", message: String(error) }));
      return withSecurityHeaders(text("Something went wrong on our side. Please try again.", 500));
    }
  },
} satisfies ExportedHandler<Env>;
