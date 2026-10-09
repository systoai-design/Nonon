import { Document, ExternalHyperlink, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import type { BriefItem, Check, EmailBrief, ProcedureDef, ProcedureOutcome, ProcedureRunContext } from "../../../../shared/contracts";
import { isGmailError } from "../../gmail/errors";
import type { GmailService } from "../../types";

/** The task layer maps an "unsupported" outcome whose reason starts with this text to a waiting task. */
export const WAITING_FOR_CONNECTIVITY = "Waiting for connectivity";

let gmail: GmailService | null = null;

/** ProcedureRunContext carries no services, so the Gmail service registers itself here when the app starts. */
export function bindGmailService(service: GmailService | null): void {
  gmail = service;
}

const SECTIONS: { priority: BriefItem["priority"]; title: string }[] = [
  { priority: "needs-attention", title: "Needs your attention" },
  { priority: "fyi", title: "Good to know" },
  { priority: "low", title: "Can wait" },
];

const when = (iso: string): string =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const dateStamp = (iso: string): string => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function briefToMarkdown(brief: EmailBrief): string {
  const out: string[] = [`# Your email summary, ${dateStamp(brief.generatedAt)}`, "", brief.summary, ""];
  if (brief.freshness === "cached") {
    out.push(`> Saved copy. Last updated from Gmail ${brief.lastSyncAt ? when(brief.lastSyncAt) : "at an unknown time"}. This is not a current check of your inbox.`, "");
  }
  for (const note of brief.notes ?? []) out.push(`- Note: ${note}`);
  if ((brief.notes ?? []).length > 0) out.push("");

  for (const section of SECTIONS) {
    const items = brief.items.filter((i) => i.priority === section.priority);
    if (items.length === 0) continue;
    out.push(`## ${section.title} (${items.length})`, "");
    for (const item of items) {
      out.push(`### ${item.subject}`, "", `- From: ${item.from}`, `- Received: ${when(item.receivedAt)}`, `- Why: ${item.why}`);
      if (item.deadline) out.push(`- Deadline (copied from the email): ${item.deadline}`);
      out.push(`- Open in Gmail: ${item.link}`);
      if (item.draftReply) {
        out.push("- Suggested reply (a draft only, nothing was sent):", "", ...item.draftReply.split("\n").map((l) => `  > ${l}`));
      }
      out.push("");
    }
  }
  out.push("---", "", "NONON read your email to make this summary. It cannot send, label, archive or delete anything. The reply drafts are only text for you to use yourself.", "");
  return out.join("\n");
}

async function briefToDocx(brief: EmailBrief): Promise<Uint8Array> {
  const line = (label: string, value: string) =>
    new Paragraph({ children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(value)] });
  const children: Paragraph[] = [
    new Paragraph({ text: `Your email summary, ${dateStamp(brief.generatedAt)}`, heading: HeadingLevel.TITLE }),
    new Paragraph({ text: brief.summary }),
  ];
  if (brief.freshness === "cached") {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Saved copy. Last updated from Gmail ${brief.lastSyncAt ? when(brief.lastSyncAt) : "at an unknown time"}. This is not a current check of your inbox.`,
            bold: true,
          }),
        ],
      }),
    );
  }
  for (const note of brief.notes ?? []) children.push(new Paragraph({ text: `Note: ${note}` }));

  for (const section of SECTIONS) {
    const items = brief.items.filter((i) => i.priority === section.priority);
    if (items.length === 0) continue;
    children.push(new Paragraph({ text: `${section.title} (${items.length})`, heading: HeadingLevel.HEADING_1 }));
    for (const item of items) {
      children.push(
        new Paragraph({ text: item.subject, heading: HeadingLevel.HEADING_2 }),
        line("From", item.from),
        line("Received", when(item.receivedAt)),
        line("Why", item.why),
      );
      if (item.deadline) children.push(line("Deadline (copied from the email)", item.deadline));
      children.push(
        new Paragraph({
          children: [new TextRun({ text: "Open in Gmail: ", bold: true }), new ExternalHyperlink({ link: item.link, children: [new TextRun({ text: item.link, style: "Hyperlink" })] })],
        }),
      );
      if (item.draftReply) {
        children.push(new Paragraph({ children: [new TextRun({ text: "Suggested reply (a draft only, nothing was sent):", bold: true })] }));
        for (const l of item.draftReply.split("\n")) children.push(new Paragraph({ children: [new TextRun({ text: l, italics: true })], indent: { left: 360 } }));
      }
    }
  }
  children.push(new Paragraph({ text: "NONON read your email to make this summary. It cannot send, label, archive or delete anything. The reply drafts are only text for you to use yourself." }));
  return new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children }] })));
}

function parseLookback(raw: string | undefined): { days?: number; bad?: boolean } {
  const text = raw?.trim();
  if (!text) return {};
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= 14 ? { days: n } : { bad: true };
}

const connectStep = "Open the email settings in NONON and choose Connect Gmail.";

async function run(ctx: ProcedureRunContext): Promise<ProcedureOutcome> {
  if (!gmail) return { kind: "unsupported", reason: "Email is not available in this version of NONON." };

  const status = gmail.status();
  if (status.state === "not-configured") {
    return { kind: "unsupported", reason: "Gmail is not set up on this computer yet.", suggestion: status.configHint };
  }
  if (status.state !== "connected") {
    return { kind: "unsupported", reason: status.detail && status.state === "error" ? status.detail : "Gmail is not connected.", suggestion: connectStep };
  }

  const lookback = parseLookback(ctx.text.lookbackDays);
  if (lookback.bad) {
    return {
      kind: "needs-input",
      reason: "Please type a whole number from 1 to 14 for how many days of email to look at.",
      questions: [{ id: "lookbackDays", prompt: "How many days of email should I look at? Type a number from 1 to 14. 2 is a good start.", kind: "text", suggested: "2" }],
    };
  }

  ctx.step("Checking Gmail", "Getting your new email from Google");
  let brief: EmailBrief;
  try {
    brief = await gmail.brief(ctx.workspace.id, { ai: ctx.ai, lookbackDays: lookback.days, signal: ctx.signal });
  } catch (e) {
    if (isGmailError(e, "no-cache") || isGmailError(e, "offline")) {
      return {
        kind: "unsupported",
        reason: `${WAITING_FOR_CONNECTIVITY}. NONON cannot reach Google, and it has no saved email yet.`,
        suggestion: "Connect to the internet once. Then this job can run.",
      };
    }
    if (isGmailError(e, "not-configured")) return { kind: "unsupported", reason: "Gmail is not set up on this computer yet.", suggestion: e.message };
    if (isGmailError(e, "not-connected") || isGmailError(e, "needs-reconnect")) {
      return { kind: "unsupported", reason: e.message, suggestion: connectStep };
    }
    if (isGmailError(e, "policy")) return { kind: "unsupported", reason: e.message };
    throw e;
  }

  ctx.step("Writing your email summary");
  const stamp = dateStamp(brief.generatedAt);
  const md = await ctx.writeOutput(`Email brief ${stamp}.md`, briefToMarkdown(brief), "md", "Email summary (text file)");
  const docx = await ctx.writeOutput(`Email brief ${stamp}.docx`, await briefToDocx(brief), "docx", "Email summary (Word document)");

  const cached = brief.freshness === "cached";
  const checks: Check[] = [
    cached
      ? { id: "freshness", label: "Email is up to date", status: "warn", detail: `This is a saved copy from ${brief.lastSyncAt ? when(brief.lastSyncAt) : "an unknown time"}. It is not a check of your inbox right now.` }
      : { id: "freshness", label: "Email is up to date", status: "pass", detail: "NONON got your email from Gmail just now." },
    cached
      ? { id: "connectivity", label: "Connected to Google", status: "warn", detail: brief.notes?.[0] ?? "NONON could not reach Google." }
      : { id: "connectivity", label: "Connected to Google", status: "pass", detail: "NONON reached Google without a problem." },
    { id: "read-only", label: "Nothing was sent or changed", status: "pass", detail: "NONON only read your email. The reply drafts are only text." },
  ];

  return { kind: "done", summary: brief.summary, outputs: [md, docx], proposals: [], checks, report: brief };
}

export const gmailBrief: ProcedureDef = {
  id: "gmail-brief",
  pack: "business",
  title: "Summarize my recent email",
  summary: "You get a list of your recent Gmail, with the emails that need you first.",
  supports:
    "Give it the number of days to look at, from 1 to 14. You get a text file and a Word document. They show what to do first, deadlines copied from the emails, links back to Gmail, and reply drafts.",
  limits: [
    "Set up Gmail once first. You also need the internet to get new email.",
    "Without the internet, it can only use email saved earlier. It tells you when that copy was last updated.",
    "It reads up to 50 emails. If you have more, it uses the newest.",
    "It never sends, labels, archives or deletes anything. Reply drafts are only text for you to use yourself.",
    "A deadline shows only if the email states one. The order is a suggestion, so check the emails that matter.",
  ],
  inputs: [
    {
      key: "lookbackDays",
      label: "Days of email to look at",
      kind: "text",
      optional: true,
      help: "Type a whole number from 1 to 14. If you leave it empty, NONON uses 2.",
    },
  ],
  revision: "1",
  run,
};

export const procedures: ProcedureDef[] = [gmailBrief];
