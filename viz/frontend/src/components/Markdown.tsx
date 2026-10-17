import { Fragment, type ReactNode } from "react";

/**
 * Model answers are Markdown: paragraphs, lists, headings, code. This renders the parts they use, and nothing
 * else (no HTML, no links that navigate), so an answer reads as written instead of as one wall of text.
 * `[1]`-style citation markers become buttons when `onCite` is given.
 */
export function Markdown({ text, onCite }: { text: string; onCite?: (marker: string) => void }) {
  return <div className="md">{blocks(text).map((b, i) => renderBlock(b, i, onCite))}</div>;
}

type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string }
  | { kind: "code"; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "quote"; text: string };

function blocks(src: string): Block[] {
  const out: Block[] = [];
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i += 1;
      out.push({ kind: "code", text: body.join("\n") });
    } else if (/^\s*$/.test(line)) {
      i += 1;
    } else if (/^\s{0,3}#{1,6}\s/.test(line)) {
      out.push({ kind: "h", text: line.replace(/^\s*#+\s*/, "") });
      i += 1;
    } else if (/^\s*[-*•]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && (/^\s*[-*•]\s+/.test(lines[i]) || /^\s*\d+[.)]\s+/.test(lines[i]))) {
        items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
        i += 1;
        // continuation lines belong to the item
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
          items[items.length - 1] += ` ${lines[i].trim()}`;
          i += 1;
        }
      }
      out.push({ kind: ordered ? "ol" : "ul", items });
    } else if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push({ kind: "quote", text: body.join(" ") });
    } else {
      const body: string[] = [];
      while (
        i < lines.length &&
        !/^\s*$/.test(lines[i]) &&
        !/^\s*```/.test(lines[i]) &&
        !/^\s{0,3}#{1,6}\s/.test(lines[i]) &&
        !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])
      )
        body.push(lines[i++].trim());
      out.push({ kind: "p", text: body.join(" ") });
    }
  }
  return out;
}

function renderBlock(b: Block, key: number, onCite?: (m: string) => void): ReactNode {
  switch (b.kind) {
    case "code":
      return (
        <pre key={key}>
          <code>{b.text}</code>
        </pre>
      );
    case "h":
      return (
        <p key={key} className="md-h">
          {inline(b.text, onCite)}
        </p>
      );
    case "ul":
    case "ol": {
      const List = b.kind;
      return (
        <List key={key}>
          {b.items.map((it, j) => (
            <li key={j}>{inline(it, onCite)}</li>
          ))}
        </List>
      );
    }
    case "quote":
      return <blockquote key={key}>{inline(b.text, onCite)}</blockquote>;
    default:
      return <p key={key}>{inline(b.text, onCite)}</p>;
  }
}

/** **bold**, *italic*, `code` and [n] citations inside a line. */
function inline(text: string, onCite?: (m: string) => void): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[\d+\]|\*[^*\s][^*]*\*)/g);
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(p)) return <code key={i}>{p.slice(1, -1)}</code>;
    if (/^\[\d+\]$/.test(p))
      return onCite ? (
        <button key={i} type="button" className="cite" onClick={() => onCite(p)} aria-label={`Show cited chunk ${p}`}>
          {p}
        </button>
      ) : (
        <span key={i} className="cite no-link">
          {p}
        </span>
      );
    if (/^\*[^*\s][^*]*\*$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}
