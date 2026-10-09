/** Reads and writes the simple "minute hour * * weekdays" cron shape that routine cards edit. */

export interface SimpleSchedule {
  hour: number;
  minute: number;
  /** 0 = Sunday ... 6 = Saturday */
  days: number[];
}

export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function expandDow(field: string): number[] | null {
  if (field === "*") return [0, 1, 2, 3, 4, 5, 6];
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const range = /^(\d)-(\d)$/.exec(part);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (a > b || b > 7) return null;
      for (let d = a; d <= b; d++) out.add(d % 7);
    } else if (/^\d$/.test(part) && Number(part) <= 7) {
      out.add(Number(part) % 7);
    } else {
      return null;
    }
  }
  return [...out].sort((x, y) => x - y);
}

export function parseCron(cron: string): SimpleSchedule | null {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const [m, h, dom, mon, dow] = f as [string, string, string, string, string];
  if (!/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(h) || dom !== "*" || mon !== "*") return null;
  const minute = Number(m);
  const hour = Number(h);
  if (minute > 59 || hour > 23) return null;
  const days = expandDow(dow);
  if (!days || days.length === 0) return null;
  return { hour, minute, days };
}

export function buildCron(s: SimpleSchedule): string {
  const days = [...new Set(s.days)].sort((a, b) => a - b);
  let dow: string;
  if (days.length === 7) dow = "*";
  else if (days.length > 2 && days.every((d, i) => i === 0 || d === (days[i - 1] as number) + 1)) dow = `${days[0]}-${days[days.length - 1]}`;
  else dow = days.join(",");
  return `${s.minute} ${s.hour} * * ${dow}`;
}

export function formatClock(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

export function humanSchedule(s: SimpleSchedule): string {
  const key = s.days.join(",");
  let when: string;
  if (s.days.length === 7) when = "Every day";
  else if (key === "1,2,3,4,5") when = "Every weekday";
  else if (key === "0,6") when = "Every weekend day";
  else if (s.days.length === 1) when = `Every ${DAY_LONG[s.days[0] as number]}`;
  else {
    const names = s.days.map((d) => DAY_SHORT[d] as string);
    when = `Every ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  return `${when} at ${formatClock(s.hour, s.minute)}`;
}
