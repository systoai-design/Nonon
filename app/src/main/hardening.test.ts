import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { ALLOWED_PERMISSIONS, PRIVACY_SWITCHES, devOrigin, isAllowedWindowRequest, isAppPage, isSafeExternalUrl } from "./hardening";

const INDEX = join(process.platform === "win32" ? "C:\\Program Files\\NONON\\resources\\app" : "/opt/nonon/app", "out", "renderer", "index.html");
const INDEX_URL = pathToFileURL(INDEX).href;

describe("which pages the window may show", () => {
  it("accepts the bundled page, with or without a hash", () => {
    expect(isAppPage(INDEX_URL, INDEX, undefined)).toBe(true);
    expect(isAppPage(`${INDEX_URL}#/settings`, INDEX, undefined)).toBe(true);
  });

  it("refuses any other file, any web address, and junk", () => {
    const other = pathToFileURL(join(INDEX, "..", "other.html")).href;
    for (const url of [other, "file:///C:/Windows/System32/drivers/etc/hosts", "https://example.com/", "http://localhost.evil.com/", "javascript:alert(1)", "data:text/html,<script>1</script>", "about:blank", "not a url", ""]) {
      expect(isAppPage(url, INDEX, undefined)).toBe(false);
    }
  });

  it("only trusts a dev server origin when one is configured, and only on localhost", () => {
    expect(devOrigin("http://localhost:5173/")).toBe("http://localhost:5173");
    expect(devOrigin("http://127.0.0.1:5173")).toBe("http://127.0.0.1:5173");
    expect(devOrigin("http://evil.example:5173")).toBeUndefined();
    expect(devOrigin("https://localhost:5173")).toBeUndefined();
    expect(devOrigin(undefined)).toBeUndefined();
    expect(isAppPage("http://localhost:5173/x", INDEX, "http://localhost:5173")).toBe(true);
    // The old check was a string prefix, so this host used to pass.
    expect(isAppPage("http://localhost.evil.com/", INDEX, "http://localhost:5173")).toBe(false);
    expect(isAppPage("http://localhost:5173/x", INDEX, undefined)).toBe(false);
  });
});

describe("what the window may request", () => {
  it("allows its own files and inline data, and nothing that leaves the computer", () => {
    expect(isAllowedWindowRequest(`${INDEX_URL}`, undefined)).toBe(true);
    expect(isAllowedWindowRequest("file:///C:/app/assets/index.js", undefined)).toBe(true);
    expect(isAllowedWindowRequest("data:image/svg+xml,%3Csvg%3E", undefined)).toBe(true);
    for (const url of ["https://example.com/a.png", "http://example.com/", "wss://example.com/", "ws://example.com/", "http://localhost:5173/", "ftp://example.com/", "http://127.0.0.1:18765/"]) {
      expect(isAllowedWindowRequest(url, undefined)).toBe(false);
    }
  });

  it("lets a dev build reach only its own dev server", () => {
    expect(isAllowedWindowRequest("http://localhost:5173/@vite/client", "http://localhost:5173")).toBe(true);
    expect(isAllowedWindowRequest("ws://localhost:5173/", "http://localhost:5173")).toBe(true);
    expect(isAllowedWindowRequest("http://localhost:9999/", "http://localhost:5173")).toBe(false);
    expect(isAllowedWindowRequest("https://example.com/", "http://localhost:5173")).toBe(false);
  });
});

describe("links handed to the system browser", () => {
  it("accepts plain https and nothing else", () => {
    expect(isSafeExternalUrl("https://mail.google.com/mail/u/0/#inbox/abc")).toBe(true);
    for (const url of ["http://example.com", "file:///C:/Windows/System32/calc.exe", "ms-msdt:/id", "javascript:alert(1)", "https://user:pw@example.com/", "https://", "mailto:a@b.c", `https://example.com/${"a".repeat(3000)}`, "calc.exe", ""]) {
      expect(isSafeExternalUrl(url)).toBe(false);
    }
  });
});

describe("window permissions and Chromium switches", () => {
  it("allows only copying to the clipboard", () => {
    expect([...ALLOWED_PERMISSIONS]).toEqual(["clipboard-sanitized-write"]);
  });

  it("turns off proxy auto-detection and name lookups for the window", () => {
    const names = PRIVACY_SWITCHES.map(([n]) => n);
    expect(names).toContain("no-proxy-server");
    expect(names).toContain("disable-background-networking");
    expect(names).toContain("disable-component-update");
    const rules = PRIVACY_SWITCHES.find(([n]) => n === "host-resolver-rules")?.[1] ?? "";
    expect(rules).toMatch(/^MAP \* ~NOTFOUND/);
    expect(rules).toContain("EXCLUDE 127.0.0.1");
  });
});
