import { describe, expect, it } from "vitest";
import { occurrencesBetween, nextAfter, validateCron } from "./cron";
import { parseSchedule } from "./schedule-parse";

describe("parseSchedule (deterministic)", () => {
  const cases: [string, string, string][] = [
    ["Every weekday at 8 a.m., compare the newest two spreadsheets in my Statements folder", "0 8 * * 1-5", "Every weekday at 8:00 AM"],
    ["Every Monday at 9 prepare my email brief", "0 9 * * 1", "Every Monday at 9:00 AM"],
    ["every day at 17:00", "0 17 * * *", "Every day at 5:00 PM"],
    ["Daily at 8:30 pm", "30 20 * * *", "Every day at 8:30 PM"],
    ["on weekends at 10am", "0 10 * * 0,6", "Every weekend at 10:00 AM"],
    ["Every Monday, Wednesday and Friday at 7:15 a.m.", "15 7 * * 1,3,5", "Every Monday, Wednesday and Friday at 7:15 AM"],
    ["every 2 hours", "0 */2 * * *", "Every 2 hours"],
    ["every hour, check the folder", "0 * * * *", "Every hour"],
    ["Every Sunday at noon", "0 12 * * 0", "Every Sunday at 12:00 PM"],
    ["Every morning, summarise my inbox", "0 8 * * *", "Every day at 8:00 AM"],
    ["a weekly report from my notes", "0 9 * * 1", "Every Monday at 9:00 AM"],
    ["On the 1st of every month at 9 a.m., total the invoices", "0 9 1 * *", "On the 1st of every month at 9:00 AM"],
    ["monday to friday at 6 pm", "0 18 * * 1-5", "Every weekday at 6:00 PM"],
    ["every Tuesday and Thursday at 2:30 p.m.", "30 14 * * 2,4", "Every Tuesday and Thursday at 2:30 PM"],
    ["Every weekday at midnight", "0 0 * * 1-5", "Every weekday at 12:00 AM"],
    ["every night at 11 pm", "0 23 * * *", "Every day at 11:00 PM"],
    ["every fri at 4pm", "0 16 * * 5", "Every Friday at 4:00 PM"],
    ["Every Saturday at 5", "0 17 * * 6", "Every Saturday at 5:00 PM"],
    ["Every weekday at 12 a.m.", "0 0 * * 1-5", "Every weekday at 12:00 AM"],
  ];

  it.each(cases)("%s", (sentence, cron, human) => {
    const parsed = parseSchedule(sentence);
    expect(parsed.cron).toBe(cron);
    expect(parsed.humanText).toBe(human);
    expect(parsed.found).toBe(true);
    expect(validateCron(parsed.cron, "Asia/Manila")).toBeNull();
    expect(parseSchedule(sentence)).toEqual(parsed);
  });

  it("does not mistake a count for a time", () => {
    const parsed = parseSchedule("Every weekday at 8 a.m., compare the newest 2 spreadsheets");
    expect(parsed.cron).toBe("0 8 * * 1-5");
  });

  it("says what it assumed instead of guessing silently", () => {
    expect(parseSchedule("weekly report").assumed.join(" ")).toMatch(/Monday/);
    expect(parseSchedule("every morning").assumed.join(" ")).toMatch(/8:00 AM/);
    expect(parseSchedule("Every Saturday at 5").assumed.join(" ")).toMatch(/5:00 PM/);
  });

  it("falls back to a visible default when no schedule is present", () => {
    const parsed = parseSchedule("please check my files");
    expect(parsed.found).toBe(false);
    expect(parsed.assumed.join(" ")).toMatch(/could not tell when/);
  });

  it("limits very frequent schedules and says so", () => {
    const parsed = parseSchedule("every 5 minutes");
    expect(parsed.cron).toBe("*/15 * * * *");
    expect(parsed.assumed.length).toBe(1);
  });
});

describe("cron in a time zone", () => {
  it("keeps 8:00 local across the America/New_York spring-forward day", () => {
    const runs = occurrencesBetween("0 8 * * *", "America/New_York", Date.parse("2026-03-06T00:00:00Z"), Date.parse("2026-03-10T23:00:00Z"));
    expect(runs.map((r) => new Date(r).toISOString())).toEqual([
      "2026-03-06T13:00:00.000Z",
      "2026-03-07T13:00:00.000Z",
      "2026-03-08T12:00:00.000Z",
      "2026-03-09T12:00:00.000Z",
      "2026-03-10T12:00:00.000Z",
    ]);
  });

  it("runs a 2:30 job once on the day 2:30 does not exist, and once on the repeated hour in autumn", () => {
    const spring = occurrencesBetween("30 2 * * *", "America/New_York", Date.parse("2026-03-08T00:00:00Z"), Date.parse("2026-03-09T00:00:00Z"));
    expect(spring).toHaveLength(1);
    const autumn = occurrencesBetween("30 1 * * *", "America/New_York", Date.parse("2026-11-01T00:00:00Z"), Date.parse("2026-11-02T00:00:00Z"));
    expect(autumn).toHaveLength(1);
  });

  it("has no shift in a zone without daylight saving (Asia/Manila)", () => {
    const runs = occurrencesBetween("0 8 * * *", "Asia/Manila", Date.parse("2026-03-06T00:00:00Z"), Date.parse("2026-11-05T00:00:00Z"));
    expect(new Set(runs.map((r) => new Date(r).toISOString().slice(11)))).toEqual(new Set(["00:00:00.000Z"]));
    expect(runs.length).toBeGreaterThan(200);
  });

  it("next occurrence is strictly after the reference time", () => {
    const at = Date.parse("2026-10-09T00:00:00Z");
    expect(new Date(nextAfter("0 8 * * *", "Asia/Manila", at)!).toISOString()).toBe("2026-10-10T00:00:00.000Z");
  });

  it("rejects bad schedules and bad zones with a plain message", () => {
    expect(validateCron("nope", "Asia/Manila")).toMatch(/five parts/);
    expect(validateCron("0 8 * * * *", "Asia/Manila")).toMatch(/five parts/);
    expect(validateCron("0 8 * * *", "Mars/Base")).toMatch(/time zone/);
    expect(validateCron("61 8 * * *", "Asia/Manila")).toMatch(/not valid/);
  });
});
