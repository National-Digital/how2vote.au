import { describe, expect, it } from "vitest";
import {
  DocumentError,
  CONTRACT,
  VOCABULARY,
  assertConserved,
  documentText,
  nativeDataSections,
  nativeDocumentRoutes,
  parseMain,
  projectDocument,
  spokenText,
} from "./build-native-documents.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const TOP = `<div class="top ui app-top"><button type="button" class="back" aria-label="Back">‹</button> <span class="label">Title</span></div>`;
const page = (body) =>
  `<html><body><main id="main">${TOP} <article class="prose"><h1>Title</h1> ${body}</article></main></body></html>`;
const project = (body) => projectDocument(page(body), "/t");
const fails = (body) => expect(() => project(body));

describe("projectDocument", () => {
  it("projects a document and leaves the top bar to the native screen", () => {
    const doc =
      project(`<p class="updated svelte-x1">Last updated: 1 July</p> <h2 id="a">A &amp; B</h2>
      <ul><li><strong>One.</strong> first</li><li>two</li></ul>`);
    expect(doc.title).toBe("Title");
    expect(doc.blocks[1]).toEqual({
      t: "paragraph",
      role: "updated",
      c: [{ t: "text", s: "Last updated: 1 July" }],
    });
    expect(doc.blocks[2]).toEqual({
      t: "heading",
      level: 2,
      id: "a",
      c: [{ t: "text", s: "A & B" }],
    });
    expect(doc.blocks[3].items).toHaveLength(2);
    expect(documentText(doc)).not.toContain("Back");
  });

  it("keeps text VoiceOver reads and drops only decorative glyphs", () => {
    const doc = project(
      `<p><a href="https://x.org" target="_blank" rel="noopener">record<span class="ext" aria-hidden="true"> ↗</span><span class="visually-hidden">(opens in a new tab)</span></a></p>`,
    );
    const link = doc.blocks[1].c[0];
    expect(link).toMatchObject({ t: "link", external: true });
    expect(link.c).toEqual([
      { t: "text", s: "record" },
      { t: "text", s: " " },
      { t: "glyph", s: "↗" },
      { t: "hidden", c: [{ t: "text", s: "(opens in a new tab)" }] },
    ]);
    // The glyph is drawn and never heard; the cue is heard and never drawn.
    expect(doc.drawn).toBe("Titlerecord ↗");
    expect(doc.spoken).toBe("Titlerecord (opens in a new tab)");
  });

  it("refuses letters or digits hidden from VoiceOver, however short", () => {
    fails(`<p>Vote <span aria-hidden="true">No</span> here.</p>`).toThrow("aria-hidden hides text");
    fails(`<p>Step <span aria-hidden="true">2</span></p>`).toThrow("aria-hidden hides text");
  });

  it("treats a protocol-relative link as another site", () => {
    expect(project(`<p><a href="//elsewhere.example/x">x</a></p>`).blocks[1].c[0].external).toBe(
      true,
    );
  });

  it("refuses an id it would drop, so a fragment link never goes nowhere", () => {
    fails(`<blockquote id="x"><p>one</p></blockquote>`).toThrow(
      "carries an id the projection does not keep",
    );
  });

  it("keeps a list item's id, as a section around its content", () => {
    const doc = project(`<ul><li id="person">A person</li></ul>`);
    expect(doc.blocks[1].items[0]).toEqual([
      { t: "section", id: "person", c: [{ t: "paragraph", c: [{ t: "text", s: "A person" }] }] },
    ]);
  });

  it("keeps the whitespace around a glyph, as the web lays it out", () => {
    const doc = project(
      `<p>See <a href="https://x.org">They Vote For You<span class="ext" aria-hidden="true"> ↗</span></a> now.</p>`,
    );
    expect(doc.drawn).toBe("TitleSee They Vote For You ↗ now.");
  });

  it("draws nothing for an empty decoration, and keeps the text's spacing", () => {
    expect(project(`<p>a <span aria-hidden="true"></span> b</p>`).drawn).toBe("Titlea b");
    expect(project(`<p>a<span aria-hidden="true"> </span>b</p>`).drawn).toBe("Titlea b");
    expect(project(`<p>text <span aria-hidden="true"></span></p>`).drawn).toBe("Titletext");
  });

  it("allows a popover and a labelled-by name only where the page's text still holds them", () => {
    fails(`<p popover="auto">Secret</p>`).toThrow("undeclared attribute popover");
    fails(`<p><a href="/x" aria-labelledby="n">x</a></p>`).toThrow(
      "undeclared attribute aria-labelledby",
    );
    expect(
      project(`<section class="note" aria-labelledby="h"><h2 id="h">Note</h2></section>`).blocks,
    ).toHaveLength(2);
  });

  it("refuses stray text in a definition list as a page fault, not a crash", () => {
    fails(`<dl class="glossary">stray<dt>T</dt><dd>D</dd></dl>`).toThrow(DocumentError);
  });

  it("holds a slot, a definition list and a glyph to what they may carry", () => {
    fails(
      `<section class="clear-data"><div class="actions" hidden><button type="button">Clear</button></div></section>`,
    ).toThrow("the clear-data slot carries hidden");
    fails(
      `<section class="clear-data"><div class="actions"><button type="button" aria-label="Other">Clear</button></div></section>`,
    ).toThrow("a slot button carries aria-label");
    fails(`<dl><dt class="visually-hidden">T</dt><dd>D</dd></dl>`).toThrow("has no native meaning");
    fails(`<p>x <span aria-hidden="true" hidden>→</span></p>`).toThrow(
      "a decorative glyph carries hidden",
    );
  });

  it("refuses a term with a name of its own, and a relative link", () => {
    fails(
      `<p><a href="/glossary#d" class="term" aria-label="Spoken">d</a> <span class="pop"><span class="dfn">D</span></span></p>`,
    ).toThrow("carries an aria-label");
    fails(`<p><a href="foo">x</a></p>`).toThrow("a relative link");
  });

  it("holds a glossary popover to what it may carry", () => {
    fails(
      `<p><a href="/glossary#d" class="term">d</a> <span class="pop" hidden><span class="dfn">D</span></span></p>`,
    ).toThrow("undeclared attribute hidden");
  });

  it("carries a link's accessible name", () => {
    const doc = project(`<p><a href="https://x.org" aria-label="A on LinkedIn">in</a></p>`);
    expect(doc.blocks[1].c[0].label).toBe("A on LinkedIn");
  });

  it("turns a glossary popover into the term's definition", () => {
    const doc = project(
      `<p>Every <a href="/glossary#d" class="term" aria-expanded="false">division</a> <span popover="auto" class="pop" role="dialog" aria-label="Definition: Division" tabindex="-1"><span class="dfn"><strong>Division</strong> A recorded vote.</span> <span class="foot"><a class="more" href="/glossary#d">Full glossary</a> <button type="button" class="x">Close</button></span></span> is recorded.</p>`,
    );
    const term = doc.blocks[1].c[1];
    expect(term).toMatchObject({
      t: "term",
      href: "/glossary#d",
      more: "Full glossary",
      close: "Close",
    });
    expect(documentText({ blocks: [{ t: "paragraph", c: term.definition }] })).toBe(
      "Division A recorded vote.",
    );
    // The popover's controls are the page's words too: drawn natively, never read inline.
    expect(documentText(doc)).toContain("Full glossaryClose");
    expect(doc.spoken).not.toContain("Full glossary");
  });

  it("collapses whitespace as a browser does, across inline boundaries", () => {
    const doc = project(`<p>
      One  <strong> two </strong>
      three<br>four </p>`);
    expect(documentText({ blocks: [doc.blocks[1]] })).toBe("One two three\nfour");
  });

  it("carries the digest of its text and the text VoiceOver reads", () => {
    const doc = project(
      `<p><a href="https://x.org" aria-label="A on LinkedIn (cue)">in</a> and <a href="/glossary#d" class="term">d</a> <span class="pop" aria-label="Definition: d"><span class="dfn">Defined.</span> <span class="foot"><a class="more" href="/glossary#d">More</a> <button type="button" class="x">Shut</button></span></span></p>`,
    );
    expect(doc.digest).toBe(createHash("sha256").update(documentText(doc)).digest("hex"));
    expect(documentText(doc)).toBe("Titlein and dDefined.MoreShut");
    expect(doc.spoken).toBe(spokenText(doc));
    expect(doc.spoken).toBe("TitleA on LinkedIn (cue) and d");
  });

  it("leaves a control to its native counterpart, and projects the text around it", () => {
    const doc = project(
      `<section class="clear-data ui" aria-labelledby="h"><h2 id="h">Clear</h2> <p class="note">Only here.</p> <div class="actions"><button type="button" class="cancel start" value="clear">Clear all</button></div></section>`,
    );
    expect(doc.blocks[1]).toMatchObject({ t: "section", role: "clear-data" });
    expect(doc.blocks[1].c[2]).toEqual({
      t: "slot",
      name: "clear-data",
      controls: [{ label: "Clear all", action: "clear" }],
    });
    expect(documentText(doc)).toContain("Only here.Clear all");
  });

  it("refuses a control slot holding anything but buttons", () => {
    fails(
      `<section class="clear-data"><div class="actions"><button type="button">Go</button> <span>Sure?</span></div></section>`,
    ).toThrow("<span> inside a control slot");
  });

  it("projects the election switch with its one current option", () => {
    const doc = project(
      `<div class="switch"><div class="toggle ui" role="group" aria-label="Choose an election"><a href="/2025/x" aria-current="page" class="on">2025</a><a href="/2022/x">2022</a></div></div>`,
    );
    expect(doc.blocks[1]).toEqual({
      t: "switch",
      label: "Choose an election",
      options: [
        { label: "2025", href: "/2025/x", current: true },
        { label: "2022", href: "/2022/x", current: false },
      ],
    });
  });

  it("refuses markup it has not been taught", () => {
    fails(`<table><tr><td>x</td></tr></table>`).toThrow("<table> has no native block");
    fails(`<p class="callout">x</p>`).toThrow('class="callout"> has no native meaning');
    fails(`<p style="color:red">x</p>`).toThrow("undeclared attribute style");
    fails(`<p title="hover text">x</p>`).toThrow("undeclared attribute title");
    fails(`<div>x</div>`).toThrow("<div> without a native role");
    fails(`<p><button type="button">Go</button></p>`).toThrow("<button> inside running text");
    fails(`<p>&copy;</p>`).toThrow("unknown entity");
  });

  it("refuses text hidden from VoiceOver", () => {
    fails(`<p><span aria-hidden="true">Authorised by someone</span></p>`).toThrow(
      "aria-hidden hides text",
    );
  });

  it("refuses a term without its definition, or a popover carrying more", () => {
    fails(`<p><a href="/glossary#d" class="term">division</a> next</p>`).toThrow(
      "has no definition",
    );
    fails(
      `<p><a href="/glossary#d" class="term">d</a> <span class="pop"><span class="dfn">D</span> <span>extra</span></span></p>`,
    ).toThrow("has no controls");
    fails(
      `<p><a href="/glossary#d" class="term">d</a> <span class="pop" aria-label="Definition: d"><span class="dfn">D</span> <span class="foot"><a class="more" href="/glossary#d">M</a> <button type="button" class="x">X</button></span> <span>extra</span></span></p>`,
    ).toThrow("undeclared content");
  });

  it("refuses a switch without exactly one current option", () => {
    fails(
      `<div class="switch"><div class="toggle" role="group" aria-label="E"><a href="/a">A</a></div></div>`,
    ).toThrow("no single current option");
  });

  it("refuses malformed markup and anything outside the article", () => {
    expect(() => projectDocument(page("<p><strong>x</p>"), "/t")).toThrow(DocumentError);
    expect(() => projectDocument(page("<script>x</script>"), "/t")).toThrow(
      "<script> inside a document",
    );
    expect(() =>
      projectDocument(`<main>${TOP}<article><h1>T</h1></article><p>stray</p></main>`, "/t"),
    ).toThrow("something other than");
    expect(() => projectDocument(`<main><article><p>no title</p></article></main>`, "/t")).toThrow(
      "no <h1>",
    );
  });
});

describe("screens and chrome", () => {
  it("carries a plain top bar's label and back button name", () => {
    expect(project("<p>Text.</p>").top).toEqual({ label: "Title", back: "Back" });
  });

  it("projects the age gate's wrappers, logo and answers", () => {
    const doc = projectDocument(
      `<main>${TOP}<div class="body"><div class="gate" role="status"><svg class="logo sm" role="img" aria-label="How2Vote"><path d="M0"></path></svg> <p class="kicker ui">Before</p> <h1>Old enough?</h1> <div class="cta declare"><button type="button" class="btn secondary" value="minor">No</button> <button type="button" class="btn" value="adult">Yes</button></div></div></div></main>`,
      "/start",
    );
    expect(doc.blocks.map((b) => b.t + (b.role ? `:${b.role}` : ""))).toEqual([
      "logo",
      "paragraph:kicker",
      "heading",
      "slot",
    ]);
    expect(doc.blocks[0]).toEqual({ t: "logo", label: "How2Vote" });
    // Reordered on the page, each answer still names what it does.
    expect(doc.blocks[3]).toEqual({
      t: "slot",
      name: "age-declare",
      controls: [
        { label: "No", action: "minor" },
        { label: "Yes", action: "adult" },
      ],
    });
  });

  it("refuses a slot whose buttons do not name exactly its actions", () => {
    const gate = (buttons) =>
      projectDocument(
        `<main>${TOP}<article><h1>T</h1><div class="cta declare">${buttons}</div></article></main>`,
        "/start",
      );
    expect(() =>
      gate(`<button type="button">Yes</button> <button type="button">No</button>`),
    ).toThrow("the age-declare slot's actions are");
    expect(() =>
      gate(
        `<button type="button" value="adult">Yes</button> <button type="button" value="adult">No</button>`,
      ),
    ).toThrow("the age-declare slot's actions are");
  });

  it("refuses a top bar carrying an action, and a wrapper carrying attributes", () => {
    const withAction = TOP.replace(
      '<span class="label">Title</span>',
      '<span class="label">Title</span> <span class="right"><button type="button">Skip</button></span>',
    );
    expect(() =>
      projectDocument(`<main>${withAction}<article><h1>T</h1></article></main>`, "/t"),
    ).toThrow("a top bar this renderer does not draw");
    expect(() =>
      projectDocument(`<main>${TOP}<div class="body" id="x"><h1>T</h1></div></main>`, "/t"),
    ).toThrow("a wrapper carries id");
  });
});

describe("the contract with the native skeleton", () => {
  it("is recorded exactly as the projection's vocabulary", () => {
    const recorded = JSON.parse(readFileSync(new URL(`../${CONTRACT}`, import.meta.url), "utf8"));
    expect(recorded).toEqual(VOCABULARY);
  });
});

describe("breadcrumbs", () => {
  const trail = (items) =>
    `<main><nav class="crumbs ui app-top" aria-label="Breadcrumb"><ol>${items}</ol></nav> <article><h1>Party</h1><p>Text.</p></article></main>`;

  it("carries a data page's trail for the native top bar, outside its text", () => {
    const doc = projectDocument(
      trail(
        `<li><a href="/">Home</a></li><li><a href="/next/parties">Parties</a></li><li><span aria-current="page">Greens</span></li>`,
      ),
      "/next/parties/greens",
    );
    expect(doc.crumbs).toEqual([
      { label: "Home", href: "/" },
      { label: "Parties", href: "/next/parties" },
      { label: "Greens" },
    ]);
    expect(documentText(doc)).toBe("PartyText.");
  });

  it("refuses a trail that does not end at the current page", () => {
    expect(() =>
      projectDocument(trail(`<li><a href="/">Home</a></li><li><a href="/x">X</a></li>`), "/t"),
    ).toThrow("does not end at the current page");
    expect(() =>
      projectDocument(
        trail(`<li><a href="https://x.org">X</a></li><li><span aria-current="page">P</span></li>`),
        "/t",
      ),
    ).toThrow("neither a route nor the current page");
    expect(() =>
      projectDocument(trail(`<li><span aria-current="page">Only</span></li>`), "/t"),
    ).toThrow("does not end at the current page");
  });
});

describe("assertConserved", () => {
  const markup = `<main>${TOP}<article><h1>Title</h1><p>Authorised by A, B.</p></article></main>`;

  it("passes when every character of the page survives", () => {
    const doc = projectDocument(markup, "/t");
    expect(() => assertConserved(parseMain(markup), doc)).not.toThrow();
  });

  it("catches a word the projection lost", () => {
    const doc = projectDocument(markup, "/t");
    doc.blocks[1].c[0].s = "Authorised by A.";
    expect(() => assertConserved(parseMain(markup), doc)).toThrow("text not conserved");
  });

  it("catches text the projection invented", () => {
    const doc = projectDocument(markup, "/t");
    doc.blocks.push({ t: "paragraph", c: [{ t: "text", s: "Vote 1." }] });
    expect(() => assertConserved(parseMain(markup), doc)).toThrow("text not conserved");
  });
});

describe("nativeDocumentRoutes", () => {
  it("reads the documents the web router offers the native core", () => {
    const router = readFileSync(
      new URL("../apps/web/src/lib/native-router.svelte.ts", import.meta.url),
      "utf8",
    );
    expect(nativeDocumentRoutes(router)).toEqual(
      expect.arrayContaining(["privacy", "terms", "about"]),
    );
  });

  it("reads the election data sections the router offers", () => {
    const router = readFileSync(
      new URL("../apps/web/src/lib/native-router.svelte.ts", import.meta.url),
      "utf8",
    );
    expect(nativeDataSections(router)).toEqual(expect.arrayContaining(["issues", "parties"]));
    expect(() => nativeDataSections("")).toThrow("declares no NATIVE_DATA_SECTIONS");
  });

  it("refuses a list entry it cannot read, rather than skipping it", () => {
    expect(() =>
      nativeDocumentRoutes(`export const NATIVE_DOCUMENTS = ["terms", 'privacy'] as const;`),
    ).toThrow("an entry this cannot read");
  });

  it("fails closed on a router it cannot read", () => {
    expect(() => nativeDocumentRoutes("const x = 1;")).toThrow("declares no NATIVE_DOCUMENTS");
    expect(() => nativeDocumentRoutes("export const NATIVE_DOCUMENTS = [] as const;")).toThrow(
      "NATIVE_DOCUMENTS is empty",
    );
    expect(() =>
      nativeDocumentRoutes('export const NATIVE_DOCUMENTS = ["terms"] as const;'),
    ).toThrow("declares no CURRENT_ELECTION_DOCUMENTS");
  });
});
