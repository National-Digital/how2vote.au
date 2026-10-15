import { describe, expect, it } from "vitest";
import { DocumentError, parseHtml } from "./prerendered-html.mjs";

const texts = (node) =>
  "text" in node ? [node.text] : (node.children ?? []).flatMap((c) => texts(c));

describe("parseHtml", () => {
  it("drops comments, running the text either side together", () => {
    const root = parseHtml(`<p>a<!--[--><!---->b<!--]--> c</p>`);
    expect(root.children[0].tag).toBe("p");
    expect(texts(root)).toEqual(["ab c"]);
  });

  it("closes a comment at its first terminator, however it is nested", () => {
    expect(texts(parseHtml(`<p>a<!-- x <!-- y -->b</p>`))).toEqual(["ab"]);
    expect(() => parseHtml(`<p><!-- <!-- x --> -->b</p>`)).toThrow(DocumentError);
  });

  it("refuses an unclosed comment", () => {
    expect(() => parseHtml(`<p>a<!-- b</p>`)).toThrow(/comment is never closed/);
  });

  it("refuses script and style, however they are written", () => {
    expect(() => parseHtml(`<p><script>x</script></p>`)).toThrow(DocumentError);
    expect(() => parseHtml(`<p><SCRIPT src="x"></SCRIPT></p>`)).toThrow(DocumentError);
    expect(() => parseHtml(`<p><scr<!-- -->ipt>x</p>`)).toThrow(DocumentError);
    expect(() => parseHtml(`<style>p{}</style>`)).toThrow(DocumentError);
  });

  it("keeps a backslash in text as text", () => {
    expect(texts(parseHtml(`<p>C:\\new &amp; \\\\</p>`))).toEqual(["C:\\new & \\\\"]);
  });
});
