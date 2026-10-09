import { humanizeCron } from "./cron";

export interface ParsedSchedule {
  cron: string;
  humanText: string;
  /** False when nothing in the sentence looked like a schedule and a default was used. */
  found: boolean;
  /** Plain-language notes about anything that was assumed. Shown on the card. */
  assumed: string[];
}

const DAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};
const ABBREVIATIONS: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  tues: 2,
  wed: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  fri: 5,
  sat: 6,
};

interface TimeOfDay {
  hour: number;
  minute: number;
  note?: string;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b([ap])\.\s?m\b\.?/g, "$1m")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ");
}

function to24(hour: number, meridiem: string | undefined): number | null {
  if (hour < 0 || hour > 23) return null;
  if (!meridiem) return hour;
  if (hour < 1 || hour > 12) return null;
  if (meridiem === "am") return hour === 12 ? 0 : hour;
  return hour === 12 ? 12 : hour + 12;
}

function parseTime(text: string): TimeOfDay | null {
  if (/\bnoon\b/.test(text)) return { hour: 12, minute: 0 };
  if (/\bmidnight\b/.test(text)) return { hour: 0, minute: 0 };

  const withColon = /\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/.exec(text);
  if (withColon) {
    const hour = to24(Number(withColon[1]), withColon[3]);
    const minute = Number(withColon[2]);
    if (hour !== null && minute < 60) return { hour, minute };
  }

  const withMeridiem = /\b(\d{1,2})\s*(am|pm)\b/.exec(text);
  if (withMeridiem) {
    const hour = to24(Number(withMeridiem[1]), withMeridiem[2]);
    if (hour !== null) return { hour, minute: 0 };
  }

  const dayPart = /\b(\d{1,2})\s+(?:o'?clock\s+)?in the (morning|afternoon|evening)\b/.exec(text);
  if (dayPart) {
    const raw = Number(dayPart[1]);
    const hour = to24(raw, dayPart[2] === "morning" ? "am" : "pm");
    if (hour !== null) return { hour, minute: 0 };
  }

  // A bare "at 5" is ambiguous; the usual office reading is 7-11 morning, 1-6 afternoon.
  const bare = /\bat (\d{1,2})\b(?!\s*(?::|st\b|nd\b|rd\b|th\b))/.exec(text);
  if (bare) {
    const raw = Number(bare[1]);
    if (raw >= 0 && raw <= 23) {
      if (raw >= 1 && raw <= 6) return { hour: raw + 12, minute: 0, note: `I read "at ${raw}" as ${raw}:00 PM.` };
      if (raw <= 12) return { hour: raw, minute: 0 };
      return { hour: raw, minute: 0 };
    }
  }
  return null;
}

function namedDays(text: string): number[] {
  const found = new Set<number>();
  for (const [name, index] of Object.entries(DAY_INDEX)) {
    if (new RegExp(`\\b${name}s?\\b`).test(text)) found.add(index);
  }
  const abbreviation = /\b(?:every|each)\s+(sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)\b/g;
  for (const m of text.matchAll(abbreviation)) found.add(ABBREVIATIONS[m[1]!]!);
  return [...found].sort((a, b) => a - b);
}

function withHuman(cron: string, found: boolean, assumed: string[]): ParsedSchedule {
  return { cron, humanText: humanizeCron(cron), found, assumed };
}

/** Deterministic: the same sentence always gives the same schedule. No model involved. */
export function parseSchedule(sentence: string): ParsedSchedule {
  const text = normalize(sentence);
  const assumed: string[] = [];

  const everyHours = /\bevery (\d{1,2}) hours?\b/.exec(text);
  if (everyHours) {
    const n = Number(everyHours[1]);
    if (n >= 1 && n <= 23) return withHuman(n === 1 ? "0 * * * *" : `0 */${n} * * *`, true, assumed);
  }
  if (/\b(hourly|every hour)\b/.test(text)) return withHuman("0 * * * *", true, assumed);
  const everyMinutes = /\bevery (\d{1,3}) minutes?\b/.exec(text);
  if (everyMinutes) {
    const requested = Number(everyMinutes[1]);
    const n = Math.min(Math.max(requested, 15), 59);
    if (n !== requested) assumed.push(`Routines run at most every 15 minutes, so I used ${n}.`);
    return withHuman(`*/${n} * * * *`, true, assumed);
  }

  const time = parseTime(text);
  if (time?.note) assumed.push(time.note);

  const monthly = /\b(monthly|every month|each month|of every month|of each month|of the month)\b/.test(text);
  const domMatch = /\b(?:on the )?(\d{1,2})(?:st|nd|rd|th)\b/.exec(text);
  const firstOf = /\b(first|1st)( day)? of\b/.test(text);

  let hour = time?.hour;
  let minute = time?.minute ?? 0;
  const defaultTime = (fallback: number, why: string): void => {
    if (hour === undefined) {
      hour = fallback;
      minute = 0;
      assumed.push(why);
    }
  };

  if (monthly || ((domMatch || firstOf) && /\bmonth\b/.test(text))) {
    let dom = 1;
    if (domMatch) dom = Number(domMatch[1]);
    if (dom < 1 || dom > 28) {
      assumed.push("Days after the 28th do not exist in every month, so I used the 28th.");
      dom = Math.min(Math.max(dom, 1), 28);
    }
    defaultTime(9, "You did not give a time, so I used 9:00 AM.");
    if (!domMatch && !firstOf) assumed.push("You did not give a day of the month, so I used the 1st.");
    return withHuman(`${minute} ${hour} ${dom} * *`, true, assumed);
  }

  let dow: string | null = null;
  let dayDefaultHour: number | null = null;
  let dayDefaultWhy = "You did not give a time, so I used 9:00 AM.";

  if (/\b(weekdays?|work ?days?|business days?|working days?)\b/.test(text) || /\b(?:mon|monday)\s*(?:-|to|through|thru)\s*(?:fri|friday)\b/.test(text)) {
    dow = "1-5";
  } else if (/\bweekends?\b/.test(text)) {
    dow = "0,6";
  } else {
    const days = namedDays(text);
    if (days.length > 0) {
      dow = days.join(",");
    } else if (/\b(every ?day|daily|each day|nightly|every (morning|afternoon|evening|night))\b/.test(text)) {
      dow = "*";
      const part = /every (morning|afternoon|evening|night)/.exec(text)?.[1];
      if (part === "morning") {
        dayDefaultHour = 8;
        dayDefaultWhy = "You did not give a time, so I used 8:00 AM for the morning.";
      } else if (part === "afternoon") {
        dayDefaultHour = 14;
        dayDefaultWhy = "You did not give a time, so I used 2:00 PM for the afternoon.";
      } else if (part === "evening") {
        dayDefaultHour = 18;
        dayDefaultWhy = "You did not give a time, so I used 6:00 PM for the evening.";
      } else if (part === "night" || /nightly/.test(text)) {
        dayDefaultHour = 21;
        dayDefaultWhy = "You did not give a time, so I used 9:00 PM for the night.";
      }
    } else if (/\b(weekly|once a week|every week|each week)\b/.test(text)) {
      dow = "1";
      assumed.push("You did not say which day, so I used Monday.");
    }
  }

  if (dow === null) {
    if (time) {
      assumed.push("You gave a time but no days, so I used every day.");
      return withHuman(`${time.minute} ${time.hour} * * *`, true, assumed);
    }
    assumed.push("I could not tell when this should run, so I started with weekdays at 9:00 AM. Change it before you save.");
    return withHuman("0 9 * * 1-5", false, assumed);
  }

  defaultTime(dayDefaultHour ?? 9, dayDefaultWhy);
  return withHuman(`${minute} ${hour} * * ${dow}`, true, assumed);
}
