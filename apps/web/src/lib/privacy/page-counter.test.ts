import { describe, expect, it } from "vitest";
import { startPageCounter } from "./page-counter";

/**
 * A document stand-in: these tests run without a DOM, and the loader only ever reads the address,
 * looks for an existing tag and appends one. Enough of a document to prove which of those it did.
 */
function docWith(hash: string) {
  const added: Array<Record<string, string>> = [];
  const doc = {
    defaultView: { location: { hash } },
    querySelector: (selector: string) =>
      added.find((el) => selector.includes(el.src ?? "")) ?? null,
    createElement: () => {
      const el: Record<string, string> = {};
      return {
        ...el,
        set type(value: string) {
          el.type = value;
        },
        set defer(value: boolean) {
          el.defer = String(value);
        },
        set src(value: string) {
          el.src = value;
        },
        setAttribute: (name: string, value: string) => {
          el[name] = value;
        },
        attributes: el,
      };
    },
    head: {
      append: (el: { attributes: Record<string, string> }) => added.push(el.attributes),
    },
  };
  return { doc: doc as unknown as Document, added };
}

describe("startPageCounter", () => {
  it("loads the counter on a plain address", () => {
    const { doc, added } = docWith("");
    expect(startPageCounter(doc)).toBe(true);
    expect(added).toHaveLength(1);
    expect(added[0]!.src).toBe("https://static.cloudflareinsights.com/beacon.min.js");
    expect(JSON.parse(added[0]!["data-cf-beacon"]!).token).toMatch(/^[0-9a-f]{32}$/);
  });

  it("loads nothing where the address carries a fragment", () => {
    // A share link encodes answers after the '#', and the privacy policy promises analytics never
    // receives it. Not loading is what keeps that promise, rather than trusting the vendor script.
    const { doc, added } = docWith("#s=abc123");
    expect(startPageCounter(doc)).toBe(false);
    expect(added).toEqual([]);
  });

  it("does not add a second counter to a page that already has one", () => {
    const { doc, added } = docWith("");
    startPageCounter(doc);
    expect(startPageCounter(doc)).toBe(false);
    expect(added).toHaveLength(1);
  });
});
