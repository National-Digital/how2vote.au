import { describe, expect, it } from "vitest";
import { ORG_ID, serializeJsonLd } from "$lib/structured-data";
import { SITE_URL } from "$lib/seo";
import { PUBLIC_SIGNATORIES, signatoryPersonGraph } from "./signatories";

describe("signatoryPersonGraph", () => {
  it("emits a Person per public signatory, linked to the Organization by @id", () => {
    const graph = signatoryPersonGraph();
    expect(graph["@graph"]).toHaveLength(PUBLIC_SIGNATORIES.length);
    expect(PUBLIC_SIGNATORIES.length).toBeGreaterThan(0);
    for (const [i, node] of graph["@graph"].entries()) {
      const s = PUBLIC_SIGNATORIES[i];
      expect(node["@type"]).toBe("Person");
      expect(node["@id"]).toBe(`${SITE_URL}/about#${s.id}`);
      expect(node.name).toBe(s.legalName);
      expect(node.jobTitle).toBe(s.jobTitle);
      // worksFor references the same Organization entity declared once in siteGraph.
      expect(node.worksFor["@id"]).toBe(ORG_ID);
      expect(node.sameAs).toEqual(s.sameAs);
    }
  });

  it("serialises and round-trips without leaking a raw '<'", () => {
    const graph = signatoryPersonGraph();
    expect(serializeJsonLd(graph)).not.toContain("<");
    expect(JSON.parse(serializeJsonLd(graph).replace(/\\u003c/g, "<"))).toEqual(graph);
  });
});
