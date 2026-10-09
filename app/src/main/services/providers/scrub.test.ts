import { describe, expect, it } from "vitest";
import { looksLikeAuthProblem, plainReason, scrubSecrets, tidyTail } from "./scrub";

describe("scrubSecrets", () => {
  it("removes keys, bearer tokens, JWTs and key=value secrets", () => {
    const raw = [
      "key sk-ant-api03-ABCDEFGHIJKLMNOP1234",
      "Authorization: Bearer abcdef1234567890abcdef",
      "jwt eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4",
      "api_key=supersecretvalue",
      '{"access_token": "abcd1234efgh5678"}',
      "https://x.test/cb?code=abcdef123456&state=ok",
      "AIzaSyA1234567890abcdefghijklmnop",
      "ghp_abcdefghijklmnopqrstuv",
    ].join("\n");
    const clean = scrubSecrets(raw);
    for (const leak of ["ABCDEFGHIJKLMNOP1234", "abcdef1234567890abcdef", "SflKxwRJSMeKKF2QT4", "supersecretvalue", "abcd1234efgh5678", "abcdef123456", "AIzaSyA1234567890", "ghp_abcdefghijklmnopqrstuv"]) {
      expect(clean).not.toContain(leak);
    }
    expect(clean).toContain("[secret]");
  });

  it("leaves ordinary sentences alone", () => {
    expect(scrubSecrets("The meeting notes are in the folder.")).toBe("The meeting notes are in the folder.");
  });
});

describe("plainReason", () => {
  it("names the provider and gives an action for sign-in problems", () => {
    const r = plainReason("claude", "Failed to authenticate: OAuth session expired");
    expect(r.code).toBe("auth");
    expect(r.message).toMatch(/^Claude needs you to sign in again/);
  });
  it("recognises limits and network problems", () => {
    expect(plainReason("codex", "429 Too Many Requests").code).toBe("limit");
    expect(plainReason("antigravity", "getaddrinfo ENOTFOUND example").message).toContain("internet");
  });
  it("never echoes secrets or ANSI noise in a generic failure", () => {
    const r = plainReason("codex", "boom \u001b[31mred\u001b[0m token=sk-ant-abcdefghijklmnopq tail");
    expect(r.message).not.toContain("sk-ant");
    expect(r.message).not.toContain("\u001b");
    expect(r.message).toContain("Codex");
  });
  it("detects auth wording", () => {
    expect(looksLikeAuthProblem("Please run /login")).toBe(true);
    expect(looksLikeAuthProblem("all good")).toBe(false);
  });
  it("tidyTail keeps only the end of a long dump", () => {
    expect(tidyTail("x".repeat(1000), 50).length).toBeLessThanOrEqual(53);
  });
});
