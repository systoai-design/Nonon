import type { ReactNode } from "react";

/**
 * Small, safe markdown renderer: headings, paragraphs, nested bullet and numbered lists, block quotes,
 * tables, rules, **bold**, *italic*, ==highlight== and `code`.
 * Output is plain React nodes, so model-written text can never inject HTML or links.
 */
const INLINE = /\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|==(.+?)==|`([^`]+)`|\*(?![\s*])(.+?)\*|\\([\\*_#>\-|=`])/g;

export function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = new RegExp(INLINE.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyBase}-${i++}`;
    if (m[1] !== undefined) out.push(<strong key={k}><em>{inline(m[1], k)}</em></strong>);
    else if (m[2] !== undefined) out.push(<strong key={k}>{inline(m[2], k)}</strong>);
    else if (m[3] !== undefined) out.push(<mark key={k}>{inline(m[3], k)}</mark>);
    else if (m[4] !== undefined) out.push(<code key={k}>{m[4]}</code>);
    else if (m[5] !== undefined) out.push(<em key={k}>{inline(m[5], k)}</em>);
    else if (m[6] !== undefined) out.push(m[6]);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

interface ListItem {
  text: string;
  ordered: boolean;
  children: ListItem[];
}

const LIST_LINE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (ch === "\\" && body[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function listTree(lines: { indent: number; ordered: boolean; text: string }[]): ListItem[] {
  const root: ListItem = { text: "", ordered: false, children: [] };
  const stack: { indent: number; node: ListItem }[] = [{ indent: -1, node: root }];
  for (const l of lines) {
    while (stack.length > 1 && (stack[stack.length - 1] as { indent: number }).indent >= l.indent) stack.pop();
    const item: ListItem = { text: l.text, ordered: l.ordered, children: [] };
    (stack[stack.length - 1] as { node: ListItem }).node.children.push(item);
    stack.push({ indent: l.indent, node: item });
  }
  return root.children;
}

function renderList(items: ListItem[], key: string): ReactNode {
  const Tag = items[0]?.ordered ? "ol" : "ul";
  return (
    <Tag key={key}>
      {items.map((it, i) => (
        <li key={i}>
          {inline(it.text, `${key}-${i}`)}
          {it.children.length > 0 && renderList(it.children, `${key}-${i}c`)}
        </li>
      ))}
    </Tag>
  );
}

function blocksOf(text: string, keyBase: string): ReactNode[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  const key = () => `${keyBase}${blocks.length}`;
  const flushPara = () => {
    if (para.length) {
      const k = key();
      blocks.push(<p key={k}>{inline(para.join(" "), k)}</p>);
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] as string;
    const line = raw.trim();
    if (line === "") {
      flushPara();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line);
    if (heading) {
      flushPara();
      const level = Math.min((heading[1] as string).length, 4);
      const k = key();
      const body = inline(heading[2] ?? "", k);
      blocks.push(
        level === 1 ? (
          <h2 key={k} className="md-h1">
            {body}
          </h2>
        ) : level === 2 ? (
          <h3 key={k} className="md-h2">
            {body}
          </h3>
        ) : (
          <h4 key={k} className={`md-h${level}`}>
            {body}
          </h4>
        ),
      );
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flushPara();
      blocks.push(<hr key={key()} />);
      continue;
    }

    if (line.startsWith("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1] as string) && (lines[i + 1] as string).includes("-")) {
      flushPara();
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1] as string).map((c) => (c.endsWith(":") ? (c.startsWith(":") ? "center" : "right") : "left"));
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && (lines[i] as string).trim().startsWith("|")) {
        rows.push(splitRow(lines[i] as string));
        i++;
      }
      i--;
      const k = key();
      const align = (n: number) => ({ textAlign: (aligns[n] ?? "left") as "left" | "right" | "center" });
      blocks.push(
        <div className="md-table-wrap" key={k}>
          <table className="md-table">
            <thead>
              <tr>
                {head.map((c, n) => (
                  <th key={n} style={align(n)}>
                    {inline(c, `${k}h${n}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {head.map((_, n) => (
                    <td key={n} style={align(n)}>
                      {inline(r[n] ?? "", `${k}r${ri}c${n}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (line.startsWith(">")) {
      flushPara();
      const quoted: string[] = [];
      while (i < lines.length && (lines[i] as string).trim().startsWith(">")) {
        quoted.push((lines[i] as string).trim().replace(/^>\s?/, ""));
        i++;
      }
      i--;
      const k = key();
      blocks.push(<blockquote key={k}>{blocksOf(quoted.join("\n"), `${k}q`)}</blockquote>);
      continue;
    }

    if (LIST_LINE.test(raw)) {
      flushPara();
      const items: { indent: number; ordered: boolean; text: string }[] = [];
      while (i < lines.length) {
        const m = LIST_LINE.exec(lines[i] as string);
        if (!m) break;
        items.push({ indent: (m[1] as string).replace(/\t/g, "  ").length, ordered: /\d/.test(m[2] as string), text: m[3] ?? "" });
        i++;
      }
      i--;
      blocks.push(renderList(listTree(items), key()));
      continue;
    }

    para.push(line);
  }
  flushPara();
  return blocks;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return <div className={`md ${className ?? ""}`}>{blocksOf(text, "b")}</div>;
}
