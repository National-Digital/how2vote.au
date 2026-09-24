#!/usr/bin/env node
/**
 * Compiles the web's prerendered documents into a closed structure a native renderer can draw.
 *
 * The source is the HTML the web itself serves, so the wording, the legal registers and the Terms
 * hash all stay where they are: the native document is a projection of the page, never a second
 * copy of it. The projection fails closed:
 *
 *   1. **Closed vocabulary.** Every element, class and attribute is either mapped or declared, so
 *      markup the native renderer has not been taught stops the build instead of disappearing.
 *   2. **Conservation.** The text of the projection equals the text of the page, character for
 *      character, less only the declared chrome — so a word cannot be lost in conversion.
 *
 * Whitespace is collapsed here, as a browser collapses it, so the native renderer draws text
 * verbatim. Each document carries the SHA-256 of its text, which the renderer recomputes from what
 * it laid out, and the text VoiceOver should read, which the simulator test compares with the
 * screen.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const IR_VERSION = 2;

const VOID = new Set(["br", "hr", "img", "input", "wbr"]);
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

/** Paragraph and section classes that carry meaning, and the role each becomes. */
export const BLOCK_ROLES = {
  updated: "updated",
  lede: "lede",
  lead: "lede",
  note: "note",
  intro: "intro",
  meta: "meta",
  source: "source",
  evidence: "evidence",
  services: "inventory",
  none: "empty",
  "clear-data": "clear-data",
};

/** Inline classes that carry meaning: a de-emphasised aside within running text. */
export const INLINE_ROLES = {
  prov: "provenance",
  evidence: "evidence",
  lead: "primary",
  meta: "secondary",
};

/** List classes that carry meaning: a table of rows, or a dense index of links. */
export const LIST_ROLES = { rows: "rows", cols: "index" };

/** Subtrees the native screen draws itself, whose text is therefore not part of the document. */
export const CHROME = [
  { match: (el) => hasClass(el, "app-top"), reason: "the screen's top bar; native draws its own" },
  { match: (el) => hasClass(el, "foot") && el.parentClass === "pop", reason: "popover controls" },
];

/**
 * Interactive controls inside a document, drawn by a native counterpart. Only the controls: the
 * text around them is projected like any other. Their labels travel with the slot, so the native
 * control is held to the web's wording.
 */
export const SLOTS = [
  {
    name: "clear-data",
    match: (el) => hasClass(el, "actions") && el.parentClass === "clear-data",
  },
];

// Classes that are presentational only: no meaning survives into the projection.
const PRESENTATIONAL = new Set(["prose", "ui", "what", "actions", "cancel", "start"]);

export class DocumentError extends Error {}

/** Parses Svelte's prerendered markup strictly: anything malformed is an error, not a guess. */
export function parseHtml(html) {
  const source = html.replace(/<!--[\s\S]*?-->/g, "");
  const root = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  const tagRe =
    /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/g;
  let last = 0;
  for (const m of source.matchAll(tagRe)) {
    if (m.index > last) pushText(stack.at(-1), source.slice(last, m.index));
    last = m.index + m[0].length;
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
  if (last < source.length) pushText(stack.at(-1), source.slice(last));
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

const classes = (el) =>
  (el.attrs?.class ?? "").split(/\s+/).filter((c) => c && !c.startsWith("svelte-"));
const hasClass = (el, c) => classes(el).includes(c);
const isBlank = (n) => "text" in n && n.text.trim() === "";

function find(node, pred) {
  if (pred(node)) return node;
  for (const c of node.children ?? []) {
    const f = find(c, pred);
    if (f) return f;
  }
  return null;
}

/** Marks each element with its parent's first class, which the chrome rules match on. */
function annotate(node, parentClass = "") {
  for (const c of node.children ?? []) {
    if (c.tag) {
      c.parentClass = parentClass;
      annotate(c, classes(c)[0] ?? "");
    }
  }
}

const isChrome = (el) => el.tag && CHROME.some((r) => r.match(el));
const slotName = (el) => el.tag && SLOTS.find((s) => s.match(el))?.name;

/** An `aria-hidden` subtree may only be decoration; real text must not hide from VoiceOver there. */
function decoration(el) {
  if (el.attrs["aria-hidden"] !== "true") return false;
  const t = textOf(el).replace(/\s/g, "");
  // A glyph: at most two characters, and never a letter or a digit, which would be words hidden
  // from VoiceOver however short.
  if (t.length > 2 || /[\p{L}\p{N}]/u.test(t)) {
    throw new DocumentError(`aria-hidden hides text "${t.slice(0, 30)}"`);
  }
  // Text alone, held to what it may carry: `hidden` or a style would draw natively a glyph the
  // web never shows.
  if (el.children.some((c) => c.tag)) throw new DocumentError("a decorative glyph holds markup");
  for (const a of Object.keys(el.attrs)) {
    if (a !== "aria-hidden" && a !== "class") {
      throw new DocumentError(`a decorative glyph carries ${a}`);
    }
  }
  checkClasses(el, new Set(["ext", "tick"]));
  return true;
}

function textOf(node) {
  if ("text" in node) return node.text;
  return (node.children ?? []).map(textOf).join("");
}

/**
 * The page's text as a reader receives it: everything in `<main>` except the declared chrome and
 * decorative `aria-hidden` glyphs.
 */
export function pageText(main) {
  const walk = (n) => {
    if ("text" in n) return n.text;
    if (isChrome(n) || decoration(n)) return "";
    return n.children.map(walk).join("");
  };
  return walk(main);
}

/** The projection's text, in reading order: what the native renderer lays out. */
export function documentText(doc) {
  return blocksText(doc.blocks, (n, inl) => {
    if (n.t === "term") return n.c.map(inl).join("") + n.definition.map(inl).join("");
    if (n.t === "glyph") return "";
    return null;
  });
}

/**
 * The text the page draws: everything but what only VoiceOver hears, with its decorative glyphs,
 * and a term's definition left to the sheet it opens. Held apart from `spokenText` so text marked
 * hidden by mistake — dropped from the screen but still spoken — is caught.
 */
export function drawnText(doc) {
  return blocksText(doc.blocks, (n, inl) => {
    if (n.t === "hidden") return "";
    if (n.t === "glyph") return n.s;
    if (n.t === "term") return n.c.map(inl).join("");
    return null;
  });
}

/**
 * The text VoiceOver reads on the native screen: a link's accessible name replaces its text, and a
 * term's definition waits behind the term rather than being read inline.
 */
export function spokenText(doc) {
  return blocksText(doc.blocks, (n, inl) => {
    if (n.t === "link" && n.label) return n.label;
    if (n.t === "term") return n.c.map(inl).join("");
    if (n.t === "glyph") return "";
    return null;
  });
}

function blocksText(blocks, special) {
  const inl = (n) => {
    const s = special(n, inl);
    if (s !== null) return s;
    if (n.t === "text") return n.s;
    if (n.t === "break") return "\n";
    return n.c.map(inl).join("");
  };
  const blk = (b) => {
    switch (b.t) {
      case "heading":
      case "paragraph":
        return b.c.map(inl).join("");
      case "list":
        return b.items.map((i) => i.map(blk).join("")).join("");
      case "definitions":
        return b.items.map((i) => i.term.map(inl).join("") + i.detail.map(blk).join("")).join("");
      case "quote":
      case "section":
        return b.c.map(blk).join("");
      case "switch":
        return b.options.map((o) => o.label).join("");
      case "slot":
        return b.controls.join("");
      default:
        throw new DocumentError(`unknown block ${b.t}`);
    }
  };
  return blocks.map(blk).join("");
}

const ALLOWED_ATTRS = new Set([
  "class",
  "id",
  "href",
  "target",
  "rel",
  "role",
  "type",
  "aria-hidden",
  "aria-expanded",
]);

/** The elements whose `id` the projection carries, so a fragment link to one can scroll to it. */
const CARRIES_ID = new Set(["h1", "h2", "h3", "p", "section", "div", "dt", "li"]);

function checkAttrs(el, extra = []) {
  for (const a of Object.keys(el.attrs)) {
    if (a === "aria-label" && el.tag === "a") continue;
    // A section named by a heading inside it, which the page's text already holds.
    if (a === "aria-labelledby" && el.tag === "section") continue;
    if (extra.includes(a)) continue;
    if (!ALLOWED_ATTRS.has(a))
      throw new DocumentError(`<${el.tag}> carries undeclared attribute ${a}`);
    // An id the projection drops is a fragment link that goes nowhere natively.
    if (a === "id" && !CARRIES_ID.has(el.tag)) {
      throw new DocumentError(`<${el.tag}> carries an id the projection does not keep`);
    }
  }
}

function checkClasses(el, meaningful) {
  for (const c of classes(el)) {
    if (!meaningful.has(c) && !PRESENTATIONAL.has(c)) {
      throw new DocumentError(`<${el.tag} class="${c}"> has no native meaning`);
    }
  }
}

function blockRole(el) {
  const role = classes(el)
    .map((c) => BLOCK_ROLES[c])
    .find(Boolean);
  return role ? { role } : {};
}

function toBlocks(children) {
  const blocks = [];
  let run = [];
  const flush = () => {
    if (run.some((n) => n.t !== "text" || n.s.trim())) blocks.push({ t: "paragraph", c: run });
    run = [];
  };
  for (let i = 0; i < children.length; i++) {
    const n = children[i];
    if ("text" in n || INLINE.has(n.tag)) {
      const [inline, skip] = toInline(children, i);
      if (inline) run.push(inline);
      i += skip;
      continue;
    }
    flush();
    const b = toBlock(n);
    if (b) blocks.push(b);
  }
  flush();
  return blocks;
}

function toBlock(el) {
  if (decoration(el)) return null;
  const slot = slotName(el);
  if (slot) {
    // The slot's element and its buttons are held to what they may carry, like every other.
    for (const a of Object.keys(el.attrs)) {
      if (a !== "class") throw new DocumentError(`the ${slot} slot carries ${a}`);
    }
    const controls = slotControls(el);
    // The native clear-data control draws one button; a second would be page text it drops.
    if (slot === "clear-data" && controls.length !== 1) {
      throw new DocumentError(`the ${slot} slot holds ${controls.length} controls`);
    }
    return { t: "slot", name: slot, controls };
  }
  checkAttrs(el);
  const id = el.attrs.id ? { id: el.attrs.id } : {};
  switch (el.tag) {
    case "h1":
    case "h2":
    case "h3":
      checkClasses(el, new Set());
      return { t: "heading", level: +el.tag[1], ...id, c: inlines(el.children) };
    case "p":
      checkClasses(el, new Set(Object.keys(BLOCK_ROLES)));
      return { t: "paragraph", ...blockRole(el), ...id, c: inlines(el.children) };
    case "ul":
    case "ol": {
      checkClasses(el, new Set(Object.keys(LIST_ROLES)));
      const role = classes(el)
        .map((c) => LIST_ROLES[c])
        .find(Boolean);
      return {
        t: "list",
        ordered: el.tag === "ol",
        ...(role ? { role } : {}),
        items: el.children
          .filter((c) => !isBlank(c))
          .map((li) => {
            if (li.tag !== "li")
              throw new DocumentError(`<${li.tag ?? "text"}> directly inside <${el.tag}>`);
            checkAttrs(li);
            checkClasses(li, new Set());
            const blocks = toBlocks(li.children);
            // An item a link points at keeps its id, as a section around the item's content.
            return li.attrs.id ? [{ t: "section", id: li.attrs.id, c: blocks }] : blocks;
          }),
      };
    }
    case "dl": {
      checkClasses(el, new Set(["glossary"]));
      const items = [];
      for (const c of el.children.filter((n) => !isBlank(n))) {
        if (c.tag !== "dt" && c.tag !== "dd") {
          throw new DocumentError(`<${c.tag ?? "text"}> out of place in <dl>`);
        }
        checkAttrs(c);
        checkClasses(c, new Set());
        if (c.tag === "dt")
          items.push({
            term: inlines(c.children),
            ...(c.attrs.id ? { id: c.attrs.id } : {}),
            detail: [],
          });
        else if (c.tag === "dd" && items.length) items.at(-1).detail.push(...toBlocks(c.children));
        else throw new DocumentError(`<${c.tag ?? "text"}> out of place in <dl>`);
      }
      return { t: "definitions", items };
    }
    case "blockquote":
      checkClasses(el, new Set());
      return { t: "quote", c: toBlocks(el.children) };
    case "div":
      if (hasClass(el, "switch")) return electionSwitch(el);
      // A bare wrapper is layout; one that groups content says so with a registered role.
      if (!blockRole(el).role) throw new DocumentError("<div> without a native role");
    // falls through
    case "section":
      checkClasses(el, new Set(Object.keys(BLOCK_ROLES)));
      return { t: "section", ...blockRole(el), ...id, c: toBlocks(el.children) };
    default:
      throw new DocumentError(`<${el.tag}> has no native block`);
  }
}

/** A slot holds buttons and nothing else; their labels are the native control's. */
function slotControls(el) {
  return el.children
    .filter((c) => !isBlank(c))
    .map((b) => {
      if (b.tag !== "button") throw new DocumentError(`<${b.tag ?? "text"}> inside a control slot`);
      if (b.children.some((c) => c.tag)) throw new DocumentError("a slot button holds markup");
      for (const a of Object.keys(b.attrs)) {
        if (a !== "type" && a !== "class") throw new DocumentError(`a slot button carries ${a}`);
      }
      return collapse(textOf(b)).trim();
    });
}

/** The election toggle: a labelled group of links, one marked current. */
function electionSwitch(el) {
  checkClasses(el, new Set(["switch"]));
  const groups = el.children.filter((c) => !isBlank(c));
  const group = groups[0];
  if (
    groups.length !== 1 ||
    !hasClass(group, "toggle") ||
    group.attrs.role !== "group" ||
    !group.attrs["aria-label"]
  ) {
    throw new DocumentError("election switch is not one labelled group");
  }
  checkAttrs(group, ["aria-label"]);
  checkClasses(group, new Set(["toggle"]));
  const options = group.children
    .filter((c) => !isBlank(c))
    .map((a) => {
      if (a.tag !== "a" || !a.attrs.href)
        throw new DocumentError("election switch holds something other than links");
      checkClasses(a, new Set(["on"]));
      for (const k of Object.keys(a.attrs)) {
        if (!["href", "class", "aria-current"].includes(k))
          throw new DocumentError(`switch link carries ${k}`);
      }
      if (a.children.some((c) => c.tag)) throw new DocumentError("a switch option holds markup");
      return {
        label: collapse(textOf(a)).trim(),
        href: a.attrs.href,
        current: a.attrs["aria-current"] === "page",
      };
    });
  if (options.filter((o) => o.current).length !== 1)
    throw new DocumentError("election switch has no single current option");
  return { t: "switch", label: group.attrs["aria-label"], options };
}

const INLINE = new Set(["strong", "b", "em", "i", "code", "a", "span", "br"]);

function inlines(children) {
  const out = [];
  for (let i = 0; i < children.length; i++) {
    const [inline, skip] = toInline(children, i);
    if (inline) out.push(inline);
    i += skip;
  }
  return out;
}

/** Converts `children[i]`, returning the node and how many following siblings it consumed. */
function toInline(children, i) {
  const n = children[i];
  if ("text" in n) return [{ t: "text", s: n.text }, 0];
  if (!INLINE.has(n.tag)) throw new DocumentError(`<${n.tag}> inside running text`);
  // Drawn, never heard: the web's ↗ beside an external link, say.
  if (decoration(n)) {
    // The whitespace around the glyph is the text's, as the web lays it out (`You ↗`), so it is
    // kept as text on either side and collapsed with the rest.
    const raw = textOf(n);
    const glyph = collapse(raw).trim();
    // An empty one draws nothing, and its whitespace is the text's alone.
    if (!glyph) return [{ t: "text", s: raw }, 0];
    const lead = /^\s*/.exec(raw)[0];
    const trail = /\s*$/.exec(raw)[0];
    return [
      {
        t: "group",
        c: [
          ...(lead ? [{ t: "text", s: lead }] : []),
          { t: "glyph", s: glyph },
          ...(trail ? [{ t: "text", s: trail }] : []),
        ],
      },
      0,
    ];
  }
  checkAttrs(n);
  switch (n.tag) {
    case "br":
      return [{ t: "break" }, 0];
    case "strong":
    case "b":
      checkClasses(n, new Set());
      return [{ t: "strong", c: inlines(n.children) }, 0];
    case "em":
    case "i":
      checkClasses(n, new Set());
      return [{ t: "em", c: inlines(n.children) }, 0];
    case "code":
      checkClasses(n, new Set());
      return [{ t: "code", c: inlines(n.children) }, 0];
    case "a":
      return link(children, i);
    case "span": {
      if (hasClass(n, "visually-hidden")) {
        checkClasses(n, new Set(["visually-hidden"]));
        return [{ t: "hidden", c: inlines(n.children) }, 0];
      }
      const role = classes(n)
        .map((c) => INLINE_ROLES[c])
        .find(Boolean);
      checkClasses(n, new Set(Object.keys(INLINE_ROLES)));
      return [
        role
          ? { t: "aside", role, c: inlines(n.children) }
          : { t: "group", c: inlines(n.children) },
        0,
      ];
    }
  }
  throw new DocumentError(`<${n.tag}> unhandled`);
}

function link(children, i) {
  const a = children[i];
  const href = a.attrs.href;
  if (!href) throw new DocumentError("<a> without href");
  if (!hasClass(a, "term")) {
    checkClasses(a, new Set(["ext", "lead"]));
    const role = hasClass(a, "lead") ? { role: INLINE_ROLES.lead } : {};
    // `//host` is another site, whatever it looks like; a bare relative href goes nowhere natively.
    const external = !(href.startsWith("/") && !href.startsWith("//")) && !href.startsWith("#");
    if (external && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("//")) {
      throw new DocumentError(`a relative link "${href}" the native screen cannot follow`);
    }
    // An accessible name replaces the link text for VoiceOver, so it travels with the link.
    const label = a.attrs["aria-label"] ? { label: a.attrs["aria-label"] } : {};
    return [{ t: "link", href, external, ...role, ...label, c: inlines(a.children) }, 0];
  }
  // A glossary term: the link is followed by its popover, which becomes the term's definition.
  checkClasses(a, new Set(["term"]));
  // A term is heard by its own text; a name replacing it is one the native term would drop.
  if (a.attrs["aria-label"]) throw new DocumentError(`term "${textOf(a)}" carries an aria-label`);
  let j = i + 1;
  let gap = "";
  while (j < children.length && isBlank(children[j])) gap += children[j++].text;
  const pop = children[j];
  if (!pop?.tag || !hasClass(pop, "pop"))
    throw new DocumentError(`term "${textOf(a)}" has no definition`);
  const dfn = pop.children.find((c) => c.tag && hasClass(c, "dfn"));
  if (!dfn) throw new DocumentError(`term "${textOf(a)}" popover has no definition`);
  // The popover and its definition are held to what they may carry, like every other element: an
  // attribute such as `hidden` would draw natively what the web never shows.
  checkAttrs(pop, ["aria-label", "popover", "tabindex"]);
  checkClasses(pop, new Set(["pop"]));
  checkAttrs(dfn);
  checkClasses(dfn, new Set(["dfn"]));
  for (const c of pop.children) {
    if (c !== dfn && !isBlank(c) && !isChrome(c)) {
      throw new DocumentError(`term "${textOf(a)}" popover carries undeclared content`);
    }
  }
  return [
    { t: "term", href, c: inlines(a.children), gap, definition: inlines(dfn.children) },
    j - i,
  ];
}

const EMPHASIS = new Set(["strong", "em", "code", "aside", "hidden"]);

const collapse = (s) => s.replace(/[ \t\n\r\f]+/g, " ");

/**
 * Collapses whitespace as a browser does, run by run, so the renderer can draw text verbatim.
 *
 * A run is the inline content of one block. A term's gap to its popover becomes ordinary text in
 * the run, and its definition is a run of its own.
 */
function normalise(blocks) {
  const run = (nodes) => {
    const texts = [];
    const walk = (list) => {
      const out = [];
      for (const n of list) {
        if (n.t === "text") {
          out.push(n);
          texts.push(n);
        } else if (n.t === "break") {
          out.push(n);
          texts.push(n);
        } else if (n.t === "glyph") {
          // Drawn among the text, as a character is: the space after it is not collapsed away.
          out.push(n);
          texts.push(n);
        } else if (n.t === "term") {
          const { gap, ...term } = n;
          term.c = walk(n.c);
          term.definition = run(n.definition);
          out.push(term);
          if (gap) {
            const t = { t: "text", s: gap };
            out.push(t);
            texts.push(t);
          }
        } else {
          out.push({ ...n, c: walk(n.c) });
        }
      }
      return out;
    };
    const result = walk(nodes);
    // Collapse across node boundaries: a space that follows a space, or starts the run, goes.
    let space = true;
    for (const t of texts) {
      if (t.t === "break") {
        space = true;
        continue;
      }
      if (t.t === "glyph") {
        space = false;
        continue;
      }
      t.s = collapse(t.s);
      if (space) t.s = t.s.replace(/^ /, "");
      if (t.s) space = t.s.endsWith(" ");
    }
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i];
      if (t.t === "break" || t.t === "glyph") break;
      t.s = t.s.replace(/ $/, "");
      if (t.s) break;
    }
    return prune(result);
  };
  const prune = (nodes) =>
    nodes
      .map((n) => (n.c && n.t !== "text" ? { ...n, c: prune(n.c) } : n))
      .filter((n) => !(n.t === "text" && n.s === "") && !(EMPHASIS.has(n.t) && n.c.length === 0));
  const block = (b) => {
    switch (b.t) {
      case "heading":
      case "paragraph":
        return { ...b, c: run(b.c) };
      case "list":
        return { ...b, items: b.items.map((i) => i.map(block)) };
      case "definitions":
        return {
          ...b,
          items: b.items.map((i) => ({ ...i, term: run(i.term), detail: i.detail.map(block) })),
        };
      case "quote":
      case "section":
        return { ...b, c: b.c.map(block) };
      default:
        return b;
    }
  };
  return blocks.map(block);
}

/** Drops presentational groups, merging their content into the surrounding run. */
function flatten(node) {
  if (Array.isArray(node)) {
    return node.flatMap((n) => (n.t === "group" ? flatten(n.c) : [flatten(n)]));
  }
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = typeof v === "object" ? flatten(v) : v;
  return out;
}

/** Parses one `<main>` element's markup. */
export function parseMain(markup) {
  return find(parseHtml(markup), (n) => n.tag === "main");
}

/**
 * Projects one prerendered page. Throws a `DocumentError` naming the first thing it cannot map, or
 * when the projection's text differs from the page's.
 */
export function projectDocument(html, route) {
  const mains = html.match(/<main[\s>][\s\S]*?<\/main>/g) ?? [];
  if (mains.length !== 1) throw new DocumentError(`${mains.length} <main> elements`);
  const main = parseMain(mains[0]);
  annotate(main);
  const content = main.children.filter((c) => !isBlank(c) && !isChrome(c));
  if (content.length !== 1 || content[0].tag !== "article") {
    throw new DocumentError("<main> holds something other than the top bar and one <article>");
  }
  const blocks = normalise(flatten(toBlocks(content[0].children)));
  const h1 = blocks.find((b) => b.t === "heading" && b.level === 1);
  if (!h1) throw new DocumentError("no <h1>");
  const crumbs = breadcrumbs(main);
  const doc = {
    v: IR_VERSION,
    route,
    // The title heads the top bar, so it is the heading as drawn: nothing only VoiceOver hears.
    title: drawnText({ blocks: [h1] }),
    ...(crumbs ? { crumbs } : {}),
    blocks,
  };
  assertConserved(main, doc);
  return {
    ...doc,
    digest: createHash("sha256").update(documentText(doc)).digest("hex"),
    spoken: spokenText(doc),
    drawn: drawnText(doc),
  };
}

/**
 * A data page's breadcrumb trail, which the native top bar draws: every crumb but the last links
 * up, and the last is the page itself. Undefined on a page with a plain top bar.
 */
function breadcrumbs(main) {
  const nav = main.children.find((c) => c.tag === "nav" && hasClass(c, "crumbs"));
  if (!nav) return undefined;
  const ol = nav.children.filter((c) => !isBlank(c));
  if (ol.length !== 1 || ol[0].tag !== "ol") throw new DocumentError("breadcrumb is not one list");
  const crumbs = ol[0].children
    .filter((c) => !isBlank(c))
    .map((li) => {
      const inner = li.children?.filter((c) => !isBlank(c)) ?? [];
      if (li.tag !== "li" || inner.length !== 1) throw new DocumentError("malformed breadcrumb");
      const [el] = inner;
      const label = collapse(textOf(el)).trim();
      if (el.tag === "a" && el.attrs.href?.startsWith("/")) return { label, href: el.attrs.href };
      if (el.tag === "span" && el.attrs["aria-current"] === "page") return { label };
      throw new DocumentError("a breadcrumb that is neither a route nor the current page");
    });
  if (crumbs.length < 2 || crumbs.slice(0, -1).some((c) => !c.href) || crumbs.at(-1).href) {
    throw new DocumentError("breadcrumb trail does not end at the current page");
  }
  return crumbs;
}

/** Fails when the projection's text differs from the page's, ignoring only whitespace. */
export function assertConserved(main, doc) {
  const want = pageText(main).replace(/\s/g, "");
  const got = documentText(doc).replace(/\s/g, "");
  if (got === want) return;
  let k = 0;
  while (k < want.length && want[k] === got[k]) k++;
  const at = (s) => s.slice(Math.max(0, k - 20), k + 20);
  throw new DocumentError(`text not conserved at "${at(want)}" (page) vs "${at(got)}" (native)`);
}

/**
 * The election data sections (`/<election>/issues`, …) the native core draws, read from the router.
 *
 * @param {string} router  apps/web/src/lib/native-router.svelte.ts
 * @returns {string[]}
 */
export function nativeDataSections(router) {
  return listIn(router, "NATIVE_DATA_SECTIONS");
}

/**
 * The documents the native core draws, read from the web router so the list has one home. Fails
 * closed: a router this cannot read ships no documents rather than a guess at them.
 *
 * @param {string} router  apps/web/src/lib/native-router.svelte.ts
 * @returns {string[]}
 */
export function nativeDocumentRoutes(router) {
  return [...listIn(router, "NATIVE_DOCUMENTS"), ...listIn(router, "CURRENT_ELECTION_DOCUMENTS")];
}

/** The documents drawn natively only while the current election is selected. */
export function currentElectionDocuments(router) {
  return listIn(router, "CURRENT_ELECTION_DOCUMENTS");
}

function listIn(router, name) {
  const list = new RegExp(`export const ${name} = \\[([^\\]]*)\\] as const;`).exec(
    router ?? "",
  )?.[1];
  if (list === undefined) throw new DocumentError(`native-router.svelte.ts declares no ${name}`);
  // Every entry must be read; one this cannot read would be offered and never projected.
  const entries = list
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  const names = entries.map((e) => /^"([a-z0-9/-]+)"$/.exec(e)?.[1]);
  if (names.some((n) => n === undefined)) {
    throw new DocumentError(`${name} holds an entry this cannot read: ${list.trim()}`);
  }
  if (names.length === 0) throw new DocumentError(`${name} is empty`);
  return names;
}

/* c8 ignore start */
function htmlFiles(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? htmlFiles(p) : f.endsWith(".html") ? [p] : [];
  });
}

function main() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const build = join(root, "apps/web/build");
  const at = process.argv.indexOf("--out");
  const out = at > 0 ? resolve(process.argv[at + 1]) : join(build, "native-documents");
  const router = readFileSync(join(root, "apps/web/src/lib/native-router.svelte.ts"), "utf8");
  const routes = nativeDocumentRoutes(router).map((r) => ({
    route: `/${r}`,
    file: join(build, `${r}.html`),
  }));
  // Every compiled election's data pages, the current one included, in the sections the router
  // offers.
  const sections = nativeDataSections(router);
  const elections = readdirSync(join(root, "data/dist")).filter((f) => existsSync(join(build, f)));
  for (const e of elections) {
    for (const section of sections) {
      const index = join(build, e, `${section}.html`);
      const files = [
        ...(existsSync(index) ? [index] : []),
        ...(existsSync(join(build, e, section)) ? htmlFiles(join(build, e, section)) : []),
      ];
      for (const file of files) {
        routes.push({ route: `/${relative(build, file).replace(/\.html$/, "")}`, file });
      }
    }
  }

  const failures = [];
  let written = 0;
  for (const { route, file } of routes) {
    try {
      const doc = projectDocument(readFileSync(file, "utf8"), route);
      const dest = join(out, `${route}.json`);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, JSON.stringify(doc) + "\n");
      written++;
    } catch (e) {
      if (!(e instanceof DocumentError)) throw e;
      failures.push({ route, message: e.message });
    }
  }

  // Grouped by message, so one unmapped class across hundreds of data pages reads as one fault.
  const byMessage = new Map();
  for (const f of failures) {
    const key = f.message.replace(/"[^"]*"/g, '"…"');
    byMessage.set(key, [...(byMessage.get(key) ?? []), f.route]);
  }
  for (const [message, rs] of byMessage) {
    console.error(`::error::native documents: ${rs.length} × ${message} (e.g. ${rs[0]})`);
  }
  console.info(`native documents: ${written}/${routes.length} projected, text conserved`);
  if (failures.length > 0) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
/* c8 ignore stop */
