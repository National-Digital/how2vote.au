/**
 * A strict parser for the markup SvelteKit prerenders: anything malformed is an error, not a guess.
 * Shared by the iOS document projection (build-native-documents.mjs) and the web's Markdown twins
 * (apps/web/scripts/build-markdown.mjs).
 */

const VOID = new Set(["br", "hr", "img", "input", "wbr"]);
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

export class DocumentError extends Error {}

/** Parses Svelte's prerendered markup strictly: anything malformed is an error, not a guess. */
export function parseHtml(html) {
  const root = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  const tagRe =
    /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/y;
  // Text runs on across comments, so `a<!---->b` is the one text "ab".
  let text = "";
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      text += html.slice(i);
      break;
    }
    text += html.slice(i, lt);
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      if (end === -1) throw new DocumentError("an HTML comment is never closed");
      i = end + 3;
      continue;
    }
    tagRe.lastIndex = lt;
    const m = tagRe.exec(html);
    if (!m) {
      text += "<";
      i = lt + 1;
      continue;
    }
    if (text) pushText(stack.at(-1), text);
    text = "";
    i = lt + m[0].length;
    const [, closing, rawTag, rawAttrs] = m;
    const tag = rawTag.toLowerCase();
    if (tag === "script" || tag === "style") throw new DocumentError(`<${tag}> inside a document`);
    if (closing) {
      const open = stack.pop();
      if (open.tag !== tag) throw new DocumentError(`</${tag}> closes <${open.tag}>`);
      continue;
    }
    const el = { tag, attrs: parseAttrs(rawAttrs), children: [] };
    stack.at(-1).children.push(el);
    if (!VOID.has(tag) && !m[4]) stack.push(el);
  }
  if (text) pushText(stack.at(-1), text);
  if (stack.length !== 1) throw new DocumentError(`<${stack.at(-1).tag}> is never closed`);
  return root;
}

function parseAttrs(raw) {
  const attrs = {};
  for (const m of raw.matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)) {
    attrs[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? "");
  }
  return attrs;
}

function pushText(parent, raw) {
  if (/[<>]/.test(raw)) throw new DocumentError(`unparsed markup: ${raw.trim().slice(0, 40)}`);
  parent.children.push({ text: decode(raw) });
}

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (_, e) => {
    if (e[0] === "#") {
      return String.fromCodePoint(
        e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1),
      );
    }
    const ch = ENTITIES[e.toLowerCase()];
    if (ch === undefined) throw new DocumentError(`unknown entity &${e};`);
    return ch;
  });
}
