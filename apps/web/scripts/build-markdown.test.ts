import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SITE_URL as APP_SITE_URL } from "../src/lib/seo";
import {
  MarkdownError,
  SITE_URL,
  announcedTwin,
  documentTags,
  htmlToMarkdown,
  pageToMarkdown,
  twinAttribution,
} from "./build-markdown.mjs";

const register = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../data/rights/rights-classes.json", import.meta.url)),
    "utf8",
  ),
);
const URL_ = "https://how2vote.au/2025/parties/example";
const md = (html: string) => htmlToMarkdown(html, URL_);

const AUTH = "Authorised by Example Pty Ltd, Gold Coast, Queensland.";
const page = (main: string, footer = `<p class="auth svelte-x">${AUTH}</p>`) =>
  `<!doctype html><html><head><title>t</title>` +
  `<link rel="alternate" type="text/markdown" href="${SITE_URL}/2025/parties/example.md"/>` +
  `<script>var a = "<main>";</script></head><body><div><main id="main" class="svelte-1">${main}</main>` +
  `<footer class="ui site-footer"><p class="credit">© X</p>${footer}</footer></div></body></html>`;

describe("htmlToMarkdown", () => {
  it("converts headings and paragraphs with inline emphasis", () => {
    expect(
      md(
        `<article class="prose svelte-81ptl9"><h1>Title</h1> <!--[0--><p class="intro">A <strong>bold</strong> and <em>soft</em> point with <code>x = 1</code>.</p><!--]--><h2>Next</h2><h3>Deeper</h3></article>`,
      ),
    ).toBe("# Title\n\nA **bold** and *soft* point with `x = 1`.\n\n## Next\n\n### Deeper");
  });

  it("makes every link absolute", () => {
    expect(
      md(
        `<p><a href="/2025/issues/x">issue</a>, <a href="#top">top</a> and <a href="https://theyvoteforyou.org.au/policies/6" target="_blank">record<span class="ext" aria-hidden="true"> ↗</span><span class="visually-hidden">(opens in a new tab)</span></a></p>`,
      ),
    ).toBe(
      `[issue](${SITE_URL}/2025/issues/x), [top](${URL_}#top) and [record](https://theyvoteforyou.org.au/policies/6)`,
    );
  });

  it("converts unordered, ordered and nested lists", () => {
    expect(
      md(
        `<ul><li>one</li><li>two<ol start="3"><li>three</li><li><strong>four.</strong> more</li></ol></li></ul>`,
      ),
    ).toBe("- one\n- two\n  3. three\n  4. **four.** more");
  });

  it("joins a row's lead and detail, keeping ballot order", () => {
    expect(
      md(
        `<ul class="rows"><!--[--><li><span class="lead">SMITH, Ann</span> <span class="detail"><!--[0--><a href="/2025/parties/liberal">Liberal</a><!--]--></span></li><li><span class="lead">JONES, Bo</span> <span class="detail">Independent</span></li></ul>`,
      ),
    ).toBe(`- SMITH, Ann — [Liberal](${SITE_URL}/2025/parties/liberal)\n- JONES, Bo — Independent`);
  });

  it("converts a table to a pipe table, escaping pipes in cells", () => {
    expect(
      md(
        `<table><caption>Bands</caption><thead><tr><th>Range</th><th>Score</th></tr></thead><tbody><tr><td>0–20</td><td>1 | low</td></tr><tr><td>20–40</td></tr></tbody></table>`,
      ),
    ).toBe("Bands\n\n| Range | Score |\n| --- | --- |\n| 0–20 | 1 \\| low |\n| 20–40 | |");
  });

  it("drops chrome, glossary popovers, controls and hidden text", () => {
    expect(
      md(
        `<nav class="crumbs ui app-top"><ol><li><a href="/2025">2025</a></li></ol></nav><p>Each row links to the <a href="/glossary#division" class="term">divisions</a> <span popover="auto" class="pop" role="dialog"><span class="dfn">Definition</span><button type="button" class="x">Close</button></span> behind it.</p><button type="button">Print</button><svg aria-hidden="true"><path d=""/></svg>`,
      ),
    ).toBe(`Each row links to the [divisions](${SITE_URL}/glossary#division) behind it.`);
  });

  it("escapes text Markdown would otherwise read as syntax", () => {
    expect(
      md(`<p>2025. A *starred* name_with [brackets] &lt;tag&gt;</p><p># not a heading</p>`),
    ).toBe("2025\\. A \\*starred\\* name\\_with \\[brackets\\] \\<tag>\n\n\\# not a heading");
  });

  it("numbers an ordered list without gaps when an item is skipped", () => {
    expect(
      md(
        `<ol><li>one</li><li hidden>gone</li><li>two</li><li aria-hidden="true">x</li><li>three</li></ol>`,
      ),
    ).toBe("1. one\n2. two\n3. three");
  });

  it("keeps the text of inline phrase elements", () => {
    expect(
      md(
        `<p>Press <kbd>Tab</kbd>, set <var>d</var> to <samp>4</samp> for <bdi>Ali</bdi>: <del>old</del> <ins>new</ins></p>`,
      ),
    ).toBe("Press Tab, set d to 4 for Ali: old new");
  });

  it("escapes a backslash in text, in running text and in a table cell", () => {
    expect(md(`<p>C:\\new\\* and a\\</p>`)).toBe("C:\\\\new\\\\\\* and a\\\\");
    expect(md(`<table><tr><td>a\\|b</td><td>end\\</td></tr></table>`)).toBe(
      "| a\\\\\\|b | end\\\\ |\n| --- | --- |",
    );
    expect(md(`<table><tr><td>one<br>two</td></tr></table>`)).toBe("| one two |\n| --- |");
  });

  it("fails closed on an element it does not know", () => {
    expect(() => md(`<p>a <object>b</object></p>`)).toThrow(MarkdownError);
  });
});

describe("pageToMarkdown", () => {
  const lines = twinAttribution(register, "/2025/electorates/example");
  const out = pageToMarkdown(
    page(`<article><h1>Example</h1><p>Body.</p></article>`),
    "/2025/parties/example",
    lines,
  );

  it("cuts <main> and ends with the source, the data attribution and the authorisation", () => {
    expect(out).toBe(
      [
        "# Example",
        "Body.",
        "---",
        `Source: <${SITE_URL}/2025/parties/example>`,
        "Vote data © They Vote For You (OpenAustralia Foundation), ODbL. Licence: [Open Database Licence v1.0](https://opendatacommons.org/licenses/odbl/1-0/).",
        "Candidate and electorate data © Commonwealth of Australia (Australian Electoral Commission). Licence: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).",
        AUTH,
      ].join("\n\n") + "\n",
    );
  });

  it("carries each required attribution from the rights register verbatim", () => {
    for (const id of ["tvfy-odbl", "aec-candidate-data"]) {
      const c = register.rightsClasses.find((r: { id: string }) => r.id === id);
      expect(out).toContain(c.attribution);
      expect(out).toContain(c.licence.url);
    }
  });

  it("ignores markup quoted inside comments and script or style text", () => {
    const html = page(`<article><h1>Example</h1><p>Body.</p></article>`).replace(
      "<title>t</title>",
      `<title>t</title><script>var s = "<!--", m = "<main><h1>Fake</h1></main>", t = "</style>";</script>` +
        `<style>a::after { content: "<main>"; }</style><!-- <main><h1>Commented</h1></main> -->`,
    );
    expect(pageToMarkdown(html, "/2025/parties/example", lines)).toBe(out);
  });

  it("refuses a page with an unclosed comment or script", () => {
    expect(() => pageToMarkdown(`<!-- <main><h1>x</h1></main>`, "/x", lines)).toThrow(
      /comment is never closed/,
    );
    expect(() => pageToMarkdown(`<script>var a = 1;<main><h1>x</h1></main>`, "/x", lines)).toThrow(
      /<script> is never closed/,
    );
  });

  it("refuses a page without the electoral authorisation", () => {
    expect(() =>
      pageToMarkdown(page(`<article><h1>Example</h1></article>`, ""), "/x", lines),
    ).toThrow(/authorisation/);
  });
});

describe("twinAttribution", () => {
  const VOTE_DATA =
    "Vote data © They Vote For You (OpenAustralia Foundation), ODbL. Licence: [Open Database Licence v1.0](https://opendatacommons.org/licenses/odbl/1-0/).";
  const CANDIDATES =
    "Candidate and electorate data © Commonwealth of Australia (Australian Electoral Commission). Licence: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).";
  const PARTY_NAMES =
    "Party names © Commonwealth of Australia (Australian Electoral Commission). Licence: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).";

  it("credits AEC candidate data on electorate and Senate twins", () => {
    expect(twinAttribution(register, "/2025/electorates/adelaide")).toEqual([
      VOTE_DATA,
      CANDIDATES,
    ]);
    expect(twinAttribution(register, "/2022/senate/act")).toEqual([VOTE_DATA, CANDIDATES]);
  });

  it("credits AEC party names on party and issue twins", () => {
    expect(twinAttribution(register, "/2025/parties/liberal")).toEqual([VOTE_DATA, PARTY_NAMES]);
    expect(twinAttribution(register, "/next/issues/x")).toEqual([VOTE_DATA, PARTY_NAMES]);
  });

  it("credits vote data alone on the methodology twin", () => {
    expect(twinAttribution(register, "/methodology")).toEqual([VOTE_DATA]);
  });

  it("builds every line from the rights register", () => {
    const edited = structuredClone(register);
    const aec = edited.rightsClasses.find((r: { id: string }) => r.id === "aec-candidate-data");
    aec.copyright = "© Changed";
    expect(twinAttribution(edited, "/2025/parties/liberal")[1]).toMatch(/^Party names © Changed\./);
  });

  it("refuses a page with no defined attribution, or a register without the class", () => {
    expect(() => twinAttribution(register, "/2025/parties")).toThrow(MarkdownError);
    expect(() => twinAttribution(register, "/how-to-decide")).toThrow(MarkdownError);
    const missing = {
      rightsClasses: register.rightsClasses.filter((r: { id: string }) => r.id !== "tvfy-odbl"),
    };
    expect(() => twinAttribution(missing, "/methodology")).toThrow(MarkdownError);
  });
});

describe("documentTags", () => {
  it("reads tags in order, skipping comments and raw text, with quoted > in attributes", () => {
    const tags = documentTags(
      `<meta content="a > b"><!-- <x> --><script>if (a<b) "</div>";</script><p class="q">t</p>`,
    );
    expect(tags.map((t) => `${t.closing ? "/" : ""}${t.tag}`)).toEqual([
      "meta",
      "script",
      "/script",
      "p",
      "/p",
    ]);
  });

  it("closes a comment at its first terminator, however it is nested", () => {
    expect(documentTags(`<!-- a <!-- b --><i>x</i>-->`).map((t) => t.tag)).toEqual(["i", "i"]);
  });
});

describe("announcedTwin", () => {
  it("reads the Markdown alternate from the head", () => {
    expect(announcedTwin(page(""))).toBe(`${SITE_URL}/2025/parties/example.md`);
    expect(announcedTwin(`<link rel="canonical" href="/x"/>`)).toBeNull();
    expect(
      announcedTwin(`<!-- <link rel="alternate" type="text/markdown" href="/x.md"> -->`),
    ).toBeNull();
  });

  it("uses the app's canonical origin", () => {
    expect(SITE_URL).toBe(APP_SITE_URL);
  });
});
