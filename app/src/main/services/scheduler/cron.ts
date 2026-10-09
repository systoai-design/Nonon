import { Cron } from "croner";

export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Plain 5-field cron only. Seconds/years fields would make a "daily" routine fire in bursts. */
export function validateCron(cron: string, timezone: string): string | null {
  if (typeof cron !== "string" || cron.trim().split(/\s+/).length !== 5) {
    return "The schedule must have five parts: minute, hour, day of month, month and day of week.";
  }
  if (!isValidTimeZone(timezone)) return `"${timezone}" is not a time zone this computer knows.`;
  try {
    const next = new Cron(cron, { timezone }).nextRun(new Date());
    if (!next) return "That schedule never comes up.";
  } catch {
    return "That schedule is not valid.";
  }
  return null;
}

/** Next occurrence strictly after `afterMs`, evaluated in `timezone`. Croner resolves DST gaps by running once, shifted forward. */
export function nextAfter(cron: string, timezone: string, afterMs: number): number | null {
  const next = new Cron(cron, { timezone }).nextRun(new Date(afterMs));
  return next ? next.getTime() : null;
}

/** Occurrences in (fromMs, toMs]. Capped so a years-old clock jump cannot spin. */
export function occurrencesBetween(cron: string, timezone: string, fromMs: number, toMs: number, cap = 5000): number[] {
  const job = new Cron(cron, { timezone });
  const out: number[] = [];
  let cursor = new Date(fromMs);
  while (out.length < cap) {
    const next = job.nextRun(cursor);
    if (!next || next.getTime() > toMs) break;
    out.push(next.getTime());
    cursor = next;
  }
  return out;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function clock(hour: number, minute: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function listWords(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function parseDays(field: string): number[] | null {
  if (field === "*") return [0, 1, 2, 3, 4, 5, 6];
  const days = new Set<number>();
  for (const part of field.split(",")) {
    const range = /^(\d)-(\d)$/.exec(part);
    if (range) {
      for (let d = Number(range[1]); d <= Number(range[2]); d++) days.add(d % 7);
    } else if (/^\d$/.test(part)) {
      days.add(Number(part) % 7);
    } else {
      return null;
    }
  }
  return [...days].sort((a, b) => a - b);
}

/** Wording for the confirmation card. Handles every shape `parseSchedule` can produce; anything else is described honestly as custom. */
export function humanizeCron(cron: string): string {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return "On a custom schedule";
  const [min, hour, dom, month, dow] = f as [string, string, string, string, string];

  const everyHours = /^\*\/(\d+)$/.exec(hour);
  if (min === "0" && everyHours && dom === "*" && month === "*" && dow === "*") {
    return Number(everyHours[1]) === 1 ? "Every hour" : `Every ${everyHours[1]} hours`;
  }
  if (min === "0" && hour === "*" && dom === "*" && month === "*" && dow === "*") return "Every hour";
  const everyMinutes = /^\*\/(\d+)$/.exec(min);
  if (everyMinutes && hour === "*" && dom === "*" && month === "*" && dow === "*") return `Every ${everyMinutes[1]} minutes`;

  if (!/^\d+$/.test(min) || !/^\d+$/.test(hour) || month !== "*") return "On a custom schedule";
  const at = clock(Number(hour), Number(min));

  if (dom !== "*" && dow === "*") {
    if (/^\d+$/.test(dom)) {
      const n = Number(dom);
      const ord = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
      return `On the ${n}${ord} of every month at ${at}`;
    }
    return "On a custom schedule";
  }
  if (dom !== "*") return "On a custom schedule";

  const days = parseDays(dow);
  if (!days) return "On a custom schedule";
  const key = days.join(",");
  if (key === "0,1,2,3,4,5,6") return `Every day at ${at}`;
  if (key === "1,2,3,4,5") return `Every weekday at ${at}`;
  if (key === "0,6") return `Every weekend at ${at}`;
  if (days.length === 1) return `Every ${DAY_NAMES[days[0]!]} at ${at}`;
  return `Every ${listWords(days.map((d) => DAY_NAMES[d]!))} at ${at}`;
}
