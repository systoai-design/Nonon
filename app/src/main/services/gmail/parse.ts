import type { RawMessage, RawPart } from "./api";

export const MAX_BODY_CHARS = 4000;

export interface CachedMessage {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  /** ISO time Gmail received it. */
  receivedAt: string;
  snippet: string;
  /** Plain text, capped at MAX_BODY_CHARS. */
  body: string;
  labelIds: string[];
}

function decodeBytes(bytes: Buffer, charset: string | undefined): string {
  try {
    return new TextDecoder(charset?.trim().toLowerCase() || "utf-8").decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

/** RFC 2047 encoded words (=?utf-8?B?...?=) appear in raw From and Subject headers. */
export function decodeMimeWords(value: string): string {
  return value
    .replace(/(\?=)\s+(=\?)/g, "$1$2")
    .replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, charset: string, enc: string, text: string) => {
      try {
        if (enc.toUpperCase() === "B") return decodeBytes(Buffer.from(text, "base64"), charset);
        const bytes = Buffer.from(
          text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16))),
          "latin1",
        );
        return decodeBytes(bytes, charset);
      } catch {
        return text;
      }
    });
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: "-", mdash: "-", hellip: "..." };

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
}

const headerOf = (part: RawPart | undefined, name: string): string => {
  const wanted = name.toLowerCase();
  return part?.headers?.find((h) => h.name?.toLowerCase() === wanted)?.value ?? "";
};

function partText(part: RawPart): string {
  const data = part.body?.data;
  if (!data) return "";
  const charset = /charset="?([^";\s]+)/i.exec(headerOf(part, "content-type"))?.[1];
  return decodeBytes(Buffer.from(data, "base64url"), charset);
}

function collect(part: RawPart | undefined, plain: string[], html: string[]): void {
  if (!part) return;
  const isAttachment = Boolean(part.filename) || Boolean(part.body?.attachmentId);
  const type = (part.mimeType ?? "").toLowerCase();
  if (!isAttachment) {
    if (type === "text/plain") plain.push(partText(part));
    else if (type === "text/html") html.push(partText(part));
  }
  for (const child of part.parts ?? []) collect(child, plain, html);
}

// Built from code points so the source stays ASCII and the invisible characters stay visible to reviewers.
const ZERO_WIDTH_RE = new RegExp("[" + [0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0xfeff].map((c) => String.fromCharCode(c)).join("") + "]", "g");

const tidy = (text: string): string =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(ZERO_WIDTH_RE, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export function extractBody(payload: RawPart | undefined): string {
  const plain: string[] = [];
  const html: string[] = [];
  collect(payload, plain, html);
  const text = plain.join("\n").trim() ? plain.join("\n") : htmlToText(html.join("\n"));
  const clean = tidy(text);
  return clean.length > MAX_BODY_CHARS ? `${clean.slice(0, MAX_BODY_CHARS)}...` : clean;
}

export function parseMessage(raw: RawMessage): CachedMessage {
  const ms = Number(raw.internalDate);
  const dateHeader = Date.parse(headerOf(raw.payload, "date"));
  const received = Number.isFinite(ms) && ms > 0 ? ms : Number.isFinite(dateHeader) ? dateHeader : Date.now();
  return {
    id: raw.id,
    threadId: raw.threadId,
    from: decodeMimeWords(headerOf(raw.payload, "from")).trim() || "Unknown sender",
    subject: decodeMimeWords(headerOf(raw.payload, "subject")).trim() || "(no subject)",
    receivedAt: new Date(received).toISOString(),
    snippet: tidy(htmlToText(raw.snippet ?? "")).slice(0, 300),
    body: extractBody(raw.payload),
    labelIds: raw.labelIds ?? [],
  };
}
