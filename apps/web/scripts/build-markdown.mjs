#!/usr/bin/env node
/**
 * Writes a Markdown twin beside each prerendered page that announces one with
 * `<link rel="alternate" type="text/markdown" href="…/x.md">` (see src/lib/markdown-twin.ts).
 *
 * The twin is the page's `<main>` converted to Markdown, followed by the data attribution from the
 * rights register (data/rights/rights-classes.json) and the page's own electoral authorisation.
 * Conversion fails closed: an element it does not know stops the build rather than disappearing.
 * Output is a pure function of the prerendered HTML and the register, so builds stay reproducible.
 *
 * Web channel only, and not in noindex (preview) builds: those carry no twins and announce none.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHtml } from "../../../scripts/prerendered-html.mjs";

export const SITE_URL = "https://how2vote.au";

export class MarkdownError extends Error {}

/** Interactive or decorative elements with no place in a text twin. */
const SKIP_TAGS = new Set([
  "button",
  "svg",
  "img",
  "picture",
  "video",
  "audio",
  "canvas",
  "iframe",
  "input",
  "select",
  "textarea",
  "form",
  "dialog",
  "template",
  "noscript",
]);

/** Page chrome, glossary popovers (the term itself links to the glossary) and screen-reader cues. */
const SKIP_CLASSES = new Set(["app-top", "pop", "visually-hidden"]);

const CONTAINERS = new Set([
  "#root",
  "main",
  "article",
  "section",
  "div",
  "nav",
  "header",
  "footer",
  "aside",
  "figure",
  "details",
]);

const PASSTHROUGH = new Set([
  "span",
  "abbr",
  "small",
  "data",
  "time",
  "sup",
  "sub",
  "mark",
  "q",
  "cite",
  "s",
  "u",
  "label",
  "dfn",
  "summary",
  "kbd",
  "var",
  "samp",
  "bdi",
  "del",
  "ins",
]);

const classes = (el) =>
  (el.attrs?.class ?? "").split(/\s+/).filter((c) => c && !c.startsWith("svelte-"));

function skipped(el) {
  if (SKIP_TAGS.has(el.tag)) return true;
  if (el.attrs["aria-hidden"] === "true" || "hidden" in el.attrs) return true;
  return classes(el).some((c) => SKIP_CLASSES.has(c));
}

const escapeText = (s) => s.replace(/([\\`*_[\]<])/g, "\\$1");

/** Escapes a leading character that Markdown would read as block syntax. */
function escapeLineStart(s) {
  if (/^\d+[.)](\s|$)/.test(s)) return s.replace(/^(\d+)([.)])/, "$1\\$2");
  if (/^(#{1,6}(\s|$)|[-+>](\s|$)|=+\s*$)/.test(s)) return `\\${s}`;
  return s;
}

function absoluteUrl(href, base) {
  if (href.startsWith("#")) return `${base}${href}`;
  if (href.startsWith("/")) return `${SITE_URL}${href}`;
  return href;
}

const encodeUrl = (u) => u.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");

/** Wraps `inner` in a delimiter, keeping its surrounding whitespace outside it. */
function wrap(inner, mark) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : inner;
}

const textOf = (n) => ("text" in n ? n.text : (n.children ?? []).map(textOf).join(""));

function inline(nodes, ctx) {
  let out = "";
  for (const n of nodes) {
    if ("text" in n) {
      out += escapeText(n.text.replace(/\s+/g, " "));
      continue;
    }
    if (skipped(n)) continue;
    const inner = () => inline(n.children, ctx);
    switch (n.tag) {
      case "a": {
        const text = inner().trim();
        const href = n.attrs.href;
        if (!text) break;
        out += href ? `[${text}](${encodeUrl(absoluteUrl(href, ctx.base))})` : text;
        break;
      }
      case "strong":
      case "b":
        out += wrap(inner(), "**");
        break;
      case "em":
      case "i":
        out += wrap(inner(), "*");
        break;
      case "code": {
        const code = textOf(n).replace(/\s+/g, " ");
        out += code.includes("`") ? `\`\` ${code} \`\`` : `\`${code}\``;
        break;
      }
      case "br":
        out += "\\\n";
        break;
      case "wbr":
        break;
      default:
        if (!PASSTHROUGH.has(n.tag)) {
          throw new MarkdownError(`<${n.tag}> where running text was expected`);
        }
        out += classes(n).includes("detail") ? ` — ${inner()}` : inner();
    }
  }
  return out;
}

/** Normalises an inline run: single spaces, no space at a line edge. */
const tidy = (s) =>
  s
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\\\n ?/g, "\\\n")
    .trim();

const isInline = (n) => "text" in n || !(Object.hasOwn(BLOCKS, n.tag) || CONTAINERS.has(n.tag));

function blocks(children, ctx) {
  const out = [];
  let run = [];
  const flush = () => {
    const text = tidy(inline(run, ctx));
    if (text) out.push(escapeLineStart(text));
    run = [];
  };
  for (const n of children) {
    if (isInline(n)) {
      run.push(n);
      continue;
    }
    flush();
    if (skipped(n)) continue;
    if (CONTAINERS.has(n.tag)) out.push(...blocks(n.children, ctx));
    else out.push(...[BLOCKS[n.tag](n, ctx)].flat().filter(Boolean));
  }
  flush();
  return out;
}

const indent = (s, pad) => s.replace(/\n(?=.)/g, `\n${pad}`);

function list(el, ctx, ordered) {
  const items = el.children.filter((c) => c.tag);
  const start = ordered ? Number.parseInt(el.attrs.start ?? "1", 10) || 1 : 0;
  const lines = [];
  for (const li of items) {
    if (li.tag !== "li") throw new MarkdownError(`<${li.tag}> directly inside <${el.tag}>`);
    if (skipped(li)) continue;
    const marker = ordered ? `${start + lines.length}.` : "-";
    const body = blocks(li.children, ctx).join("\n");
    lines.push(`${marker} ${indent(body, " ".repeat(marker.length + 1))}`);
  }
  return lines.join("\n");
}

/**
 * Fits one escape sequence or pipe into a table cell: a hard break becomes a space, a pipe is
 * escaped, and every existing escape is kept whole so its backslash is never re-read.
 */
const cellEscape = (m) => (m === "|" ? "\\|" : m === "\\\n" ? " " : m);

function table(el, ctx) {
  const rows = [];
  const collect = (n) => {
    for (const c of n.children) {
      if (!c.tag || skipped(c)) continue;
      if (c.tag === "tr") rows.push(c);
      else if (["thead", "tbody", "tfoot"].includes(c.tag)) collect(c);
      else if (c.tag !== "caption" && c.tag !== "colgroup") {
        throw new MarkdownError(`<${c.tag}> inside <table>`);
      }
    }
  };
  collect(el);
  if (rows.length === 0) return "";
  const cells = rows.map((r) =>
    r.children
      .filter((c) => c.tag === "th" || c.tag === "td")
      .map((c) => tidy(inline(c.children, ctx)).replace(/\\[\s\S]|\|/g, cellEscape)),
  );
  const width = Math.max(...cells.map((r) => r.length));
  const line = (r) =>
    `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`.replace(/ {2}/g, " ");
  const caption = el.children.find((c) => c.tag === "caption");
  return [
    ...(caption ? [escapeLineStart(tidy(inline(caption.children, ctx)))] : []),
    [line(cells[0]), line(Array(width).fill("---")), ...cells.slice(1).map(line)].join("\n"),
  ];
}

const BLOCKS = {
  h1: (el, ctx) => `# ${tidy(inline(el.children, ctx))}`,
  h2: (el, ctx) => `## ${tidy(inline(el.children, ctx))}`,
  h3: (el, ctx) => `### ${tidy(inline(el.children, ctx))}`,
  h4: (el, ctx) => `#### ${tidy(inline(el.children, ctx))}`,
  h5: (el, ctx) => `##### ${tidy(inline(el.children, ctx))}`,
  h6: (el, ctx) => `###### ${tidy(inline(el.children, ctx))}`,
  p: (el, ctx) => escapeLineStart(tidy(inline(el.children, ctx))),
  figcaption: (el, ctx) => escapeLineStart(tidy(inline(el.children, ctx))),
  ul: (el, ctx) => list(el, ctx, false),
  ol: (el, ctx) => list(el, ctx, true),
  table,
  hr: () => "---",
  pre: (el) => {
    const code = textOf(el).replace(/\n$/, "");
    const fence = code.includes("```") ? "~~~" : "```";
    return `${fence}\n${code}\n${fence}`;
  },
  blockquote: (el, ctx) =>
    blocks(el.children, ctx)
      .join("\n\n")
      .split("\n")
      .map((l) => (l ? `> ${l}` : ">"))
      .join("\n"),
  dl: (el, ctx) =>
    el.children
      .filter((c) => c.tag && !skipped(c))
      .map((c) => {
        const text = tidy(inline(c.children, ctx));
        if (c.tag === "dt") return `**${text}**`;
        if (c.tag === "dd") return escapeLineStart(text);
        throw new MarkdownError(`<${c.tag}> inside <dl>`);
      }),
};

/** Converts an HTML fragment to Markdown. `url` is the page's canonical URL, for `#` links. */
export function htmlToMarkdown(fragment, url) {
  return blocks(parseHtml(fragment).children, { base: url }).join("\n\n");
}

/**
 * The tags of a whole page in document order, outside comments and the raw text of `<script>` and
 * `<style>`, so markup quoted there is never taken for the page's own.
 *
 * @param {string} html
 * @returns {Array<{ tag: string, closing: boolean, start: number, end: number, source: string }>}
 */
export function documentTags(html) {
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(?:[^>"']|"[^"]*"|'[^']*')*>/y;
  const lower = html.toLowerCase();
  const tags = [];
  let i = 0;
  while ((i = html.indexOf("<", i)) !== -1) {
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      if (end === -1) throw new MarkdownError("an HTML comment is never closed");
      i = end + 3;
      continue;
    }
    tagRe.lastIndex = i;
    const m = tagRe.exec(html);
    if (!m) {
      i++;
      continue;
    }
    const tag = m[2].toLowerCase();
    const closing = m[1] === "/";
    tags.push({ tag, closing, start: i, end: i + m[0].length, source: m[0] });
    i += m[0].length;
    if (!closing && (tag === "script" || tag === "style")) {
      const end = lower.indexOf(`</${tag}`, i);
      if (end === -1) throw new MarkdownError(`<${tag}> is never closed`);
      i = end;
    }
  }
  return tags;
}

/** The Markdown twin URL a page announces in its head, or null. */
export function announcedTwin(html) {
  for (const { tag, closing, source } of documentTags(html)) {
    if (tag !== "link" || closing) continue;
    if (/\brel="alternate"/.test(source) && /\btype="text\/markdown"/.test(source)) {
      const href = /\bhref="([^"]*)"/.exec(source);
      if (!href) throw new MarkdownError("a Markdown alternate link has no href");
      return href[1];
    }
  }
  return null;
}

/**
 * @typedef {{ id: string, attribution: string, copyright: string, licence: { name: string, url: string } }} RightsClass
 * @param {{ rightsClasses: RightsClass[] }} register
 * @param {string} id
 * @returns {RightsClass}
 */
function rightsClass(register, id) {
  const c = register.rightsClasses.find((r) => r.id === id);
  if (!c?.attribution || !c.copyright || !c.licence?.url) {
    throw new MarkdownError(`rights register has no attribution for ${id}`);
  }
  return c;
}

/** @param {string} text @param {RightsClass} c */
const licenceLine = (text, c) =>
  `${escapeText(text)}. Licence: [${escapeText(c.licence.name)}](${c.licence.url}).`;

/**
 * The attribution lines a twin carries, by the data its page shows, from the rights register.
 *
 * Every twin shows They Vote For You vote data or describes its use. Electorate and Senate pages list
 * AEC candidates; party and issue pages name parties by their AEC-registered names.
 *
 * @param {{ rightsClasses: RightsClass[] }} register
 * @param {string} path  the page's canonical path
 * @returns {string[]}
 */
export function twinAttribution(register, path) {
  const tvfy = rightsClass(register, "tvfy-odbl");
  const aec = rightsClass(register, "aec-candidate-data");
  const voteData = licenceLine(tvfy.attribution, tvfy);
  if (path === "/methodology") return [voteData];
  const section = /^\/[^/]+\/(electorates|senate|parties|issues)\/[^/]+$/.exec(path)?.[1];
  if (section === "electorates" || section === "senate") {
    return [voteData, licenceLine(aec.attribution, aec)];
  }
  if (section === "parties" || section === "issues") {
    // Registered party names are credited as facts, with no licence, as in /data/ positions.json.
    return [voteData, `${escapeText(`Registered party names ${aec.copyright}`)}.`];
  }
  throw new MarkdownError(`${path}: no attribution is defined for this page`);
}

/**
 * The full twin for one prerendered page.
 *
 * @param {string} html  the page as served
 * @param {string} path  its canonical path, e.g. `/2025/parties/liberal`
 * @param {string[]} attribution  lines from {@link twinAttribution}
 */
export function pageToMarkdown(html, path, attribution) {
  const tags = documentTags(html);
  const open = tags.find((t) => !t.closing && t.tag === "main");
  const close = tags.findLast((t) => t.closing && t.tag === "main");
  if (!open || !close || close.start < open.end) throw new MarkdownError(`${path}: no <main>`);
  const main = html.slice(open.start, close.end);
  const authOpen = tags.find((t) => !t.closing && /^<p class="auth\b[^"]*">$/.test(t.source));
  const authClose =
    authOpen && tags.find((t) => t.closing && t.tag === "p" && t.start > authOpen.start);
  const authText = authClose
    ? htmlToMarkdown(`<p>${html.slice(authOpen.end, authClose.start)}</p>`, "")
    : "";
  if (!authText.startsWith("Authorised by ")) {
    throw new MarkdownError(`${path}: no electoral authorisation in the page footer`);
  }
  const url = `${SITE_URL}${path}`;
  const body = htmlToMarkdown(main, url);
  if (!body.startsWith("# ")) throw new MarkdownError(`${path}: <main> does not open with <h1>`);
  return `${[body, "---", `Source: <${url}>`, ...attribution, authText].join("\n\n")}\n`;
}

function htmlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "_app") out.push(...htmlFiles(p));
    } else if (entry.name.endsWith(".html")) out.push(p);
  }
  return out.sort();
}

/* c8 ignore start */
function main() {
  const channel = process.env.PUBLIC_DIST_CHANNEL;
  if (channel === "ios" || channel === "android" || channel === "fdroid") {
    console.info(`markdown twins: none for the ${channel} channel`);
    return;
  }
  if (process.env.PUBLIC_NOINDEX === "1") {
    console.info("markdown twins: none for a noindex build");
    return;
  }
  const build = fileURLToPath(new URL("../build", import.meta.url));
  const register = JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../../../data/rights/rights-classes.json", import.meta.url)),
      "utf8",
    ),
  );

  let written = 0;
  for (const file of htmlFiles(build)) {
    const html = readFileSync(file, "utf8");
    const twin = announcedTwin(html);
    if (!twin) continue;
    const path = `/${relative(build, file).split(sep).join("/")}`.replace(/\.html$/, "");
    if (twin !== `${SITE_URL}${path}.md`) {
      throw new MarkdownError(`${path} announces ${twin}, expected ${SITE_URL}${path}.md`);
    }
    if (/<meta name="robots" content="noindex\b/.test(html)) {
      throw new MarkdownError(`${path} is noindex but announces a Markdown twin`);
    }
    const md = pageToMarkdown(html, path, twinAttribution(register, path));
    const dest = join(build, `${path.slice(1)}.md`);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, md);
    written++;
  }
  if (written === 0) throw new MarkdownError("no page announces a Markdown twin");
  console.info(`markdown twins: ${written} written`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
/* c8 ignore stop */
