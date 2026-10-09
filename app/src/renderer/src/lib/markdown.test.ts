import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown";

const html = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

describe("Markdown", () => {
  it("renders headings, bold, italic and highlight", () => {
    const out = html("# Title\n\n## Part\n\nSome **bold** and *slanted* and ==check this== text.");
    expect(out).toContain('<h2 class="md-h1">Title</h2>');
    expect(out).toContain('<h3 class="md-h2">Part</h3>');
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>slanted</em>");
    expect(out).toContain("<mark>check this</mark>");
  });

  it("renders a highlight inside bold, the way the document writer produces it", () => {
    expect(html("**==Missing: owner==**")).toContain("<strong><mark>Missing: owner</mark></strong>");
  });

  it("renders bold italic, which a bold run inside an italic quote becomes", () => {
    expect(html('***file.txt:3*** *"the quote"*')).toContain("<strong><em>file.txt:3</em></strong> <em>&quot;the quote&quot;</em>");
  });

  it("renders nested bullet and numbered lists", () => {
    const out = html("- one\n  - nested\n- two\n\n1. first\n2. second");
    expect(out).toContain("<ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul>");
    expect(out).toContain("<ol><li>first</li><li>second</li></ol>");
  });

  it("renders a table with escaped pipes and alignment", () => {
    const out = html("| Who | Amount |\n| --- | ---: |\n| Sam | 5 \\| 6 |");
    expect(out).toContain("<th");
    expect(out).toContain("Sam");
    expect(out).toContain("5 | 6");
    expect(out).toContain("text-align:right");
  });

  it("renders block quotes", () => {
    expect(html("> **Note:** read this")).toContain("<blockquote><p><strong>Note:</strong> read this</p></blockquote>");
  });

  it("keeps the old summary behaviour: lines of one paragraph join, a blank line starts a new one", () => {
    expect(html("first line\nsecond line\n\nnext")).toBe('<div class="md "><p>first line second line</p><p>next</p></div>');
  });

  it("never turns text into HTML", () => {
    const out = html("<script>alert(1)</script> <img src=x onerror=alert(1)> [link](https://example.com)");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<a ");
    expect(out).toContain("&lt;script&gt;");
  });

  it("treats an escaped leading marker as plain text", () => {
    expect(html("\\# not a heading")).toContain("<p># not a heading</p>");
  });
});
