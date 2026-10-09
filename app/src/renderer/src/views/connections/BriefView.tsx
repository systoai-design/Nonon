import { useState } from "react";
import { ExternalLink } from "lucide-react";
import type { BriefItem, EmailBrief } from "../../../../shared/contracts";
import { formatDateTime, openHttps, relativeTime } from "../lib";
import { CopyButton, Notice } from "../ui";
import { Icon } from "../../components/Icon";

const GROUPS: { id: BriefItem["priority"]; title: string }[] = [
  { id: "needs-attention", title: "Do these first" },
  { id: "fyi", title: "Good to know" },
  { id: "low", title: "Can wait" },
];

function Item({ item }: { item: BriefItem }) {
  const [draft, setDraft] = useState(item.draftReply ?? "");
  const canOpen = item.link.startsWith("https://");
  return (
    <li className="flex flex-col gap-2 py-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <div className="font-semibold">{item.subject}</div>
          <div className="text-[13.5px] muted">
            {item.from} &middot; {formatDateTime(item.receivedAt)}
          </div>
        </div>
        {canOpen && (
          <button type="button" className="btn btn-ghost !px-2 !py-1 text-[13.5px]" onClick={() => openHttps(item.link)}>
            <ExternalLink size={14} aria-hidden /> Open in Gmail
          </button>
        )}
      </div>
      <p className="m-0 text-[14.5px]">{item.why}</p>
      {item.deadline && (
        <span className="chip chip-attn self-start">
          <Icon name="calendar" size={15} tone="accent" /> Deadline: {item.deadline}
        </span>
      )}
      {item.draftReply !== undefined && (
        <div className="flex flex-col gap-2">
          <label className="text-[13.5px] font-medium" htmlFor={`draft-${item.messageId}`}>
            Draft reply (you can edit it)
          </label>
          <textarea id={`draft-${item.messageId}`} className="input" rows={5} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="flex flex-wrap items-center gap-3">
            <CopyButton text={draft} label="Copy draft" />
            <span className="text-[13px] muted">NONON never sends or deletes email. Copy this and send it yourself.</span>
          </div>
        </div>
      )}
    </li>
  );
}

export function BriefView({ brief }: { brief: EmailBrief }) {
  const fresh = brief.freshness === "fresh";
  const minutesOld = (Date.now() - new Date(brief.generatedAt).getTime()) / 60000;
  return (
    <div className="flex flex-col gap-4">
      {fresh ? (
        <Notice tone="good" title={minutesOld < 5 ? "Up to date: checked Gmail just now" : `Up to date: checked Gmail ${relativeTime(brief.generatedAt)}`} />
      ) : (
        <Notice tone="warn" title={`From email saved earlier. Last updated ${brief.lastSyncAt ? formatDateTime(brief.lastSyncAt) : "never"}.`}>
          It may be out of date.
        </Notice>
      )}
      {brief.summary && <p className="m-0">{brief.summary}</p>}
      {brief.items.length === 0 && <p className="m-0 muted">Nothing needs a look in this email.</p>}
      {GROUPS.map((g) => {
        const items = brief.items.filter((i) => i.priority === g.id);
        if (items.length === 0) return null;
        return (
          <section key={g.id} aria-label={g.title}>
            <h3 className="flex items-center gap-2">
              {g.title} <span className="chip">{items.length}</span>
            </h3>
            <ul className="m-0 list-none divide-y divide-[color:var(--line)] p-0">
              {items.map((i) => (
                <Item key={i.messageId} item={i} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
