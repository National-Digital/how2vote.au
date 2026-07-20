import { describe, expect, it } from "vitest";
import { ELECTIONS } from "@how2vote/data-schema";
import { SITE_URL } from "./seo";
import {
  ORG_ID,
  WEBSITE_ID,
  WEBAPP_ID,
  INSIGHTS_DATASET_ID,
  SOURCE_REPO_URL,
  siteGraph,
  insightsDatasetGraph,
  methodologyHowToGraph,
  HOWTO_STEPS,
  breadcrumbGraph,
  faqGraph,
  serializeJsonLd,
} from "./structured-data";

/** Pull a typed node out of the sitewide `@graph` by its `@type`. */
function node(type: string): Record<string, unknown> {
  const graph = siteGraph()["@graph"] as Array<Record<string, unknown>>;
  const found = graph.find((n) => n["@type"] === type);
  expect(found, `sitewide @graph is missing a ${type} node`).toBeDefined();
  return found as Record<string, unknown>;
}

describe("siteGraph", () => {
  it("declares the schema.org context and one node per type", () => {
    const graph = siteGraph();
    expect(graph["@context"]).toBe("https://schema.org");
    const types = (graph["@graph"] as Array<Record<string, unknown>>).map((n) => n["@type"]);
    expect(types).toEqual(["Organization", "WebSite", "WebApplication"]);
  });

  it("gives every node a stable @id on the canonical origin", () => {
    expect(node("Organization")["@id"]).toBe(ORG_ID);
    expect(node("WebSite")["@id"]).toBe(WEBSITE_ID);
    expect(node("WebApplication")["@id"]).toBe(WEBAPP_ID);
    for (const id of [ORG_ID, WEBSITE_ID, WEBAPP_ID]) {
      expect(id.startsWith(SITE_URL + "/#")).toBe(true);
    }
  });

  it("links WebSite and WebApplication to the Organization by @id (not re-declared)", () => {
    expect(node("WebSite").publisher).toEqual({ "@id": ORG_ID });
    expect(node("WebApplication").publisher).toEqual({ "@id": ORG_ID });
  });

  it("lists the public source repo as the WebApplication's sameAs", () => {
    expect(node("WebApplication").sameAs).toEqual([SOURCE_REPO_URL]);
    expect(SOURCE_REPO_URL).toBe("https://github.com/National-Digital/how2vote.au");
  });

  it("marks the WebApplication free (a $0 offer, accessible for free)", () => {
    const app = node("WebApplication");
    expect(app.isAccessibleForFree).toBe(true);
    expect(app.offers).toEqual({ "@type": "Offer", price: "0", priceCurrency: "AUD" });
  });

  it("asserts no rating or review signal (neutrality)", () => {
    const app = node("WebApplication");
    expect(app.aggregateRating).toBeUndefined();
    expect(app.review).toBeUndefined();
  });
});

describe("insightsDatasetGraph", () => {
  const ds = insightsDatasetGraph();

  it("is a Dataset with the schema.org context and a stable @id", () => {
    expect(ds["@context"]).toBe("https://schema.org");
    expect(ds["@type"]).toBe("Dataset");
    expect(ds["@id"]).toBe(INSIGHTS_DATASET_ID);
    expect(ds.url).toBe(`${SITE_URL}/insights`);
  });

  it("credits the Organization by the same @id as the sitewide graph", () => {
    expect(ds.creator).toEqual({ "@id": ORG_ID });
  });

  it("does not assert a licence it does not have", () => {
    // The ODbL in LICENSE-DATA covers the vote dataset, not these survey aggregates.
    expect((ds as Record<string, unknown>).license).toBeUndefined();
  });

  it("covers the full election year range", () => {
    const years = ELECTIONS.map((e) => e.year);
    expect(ds.temporalCoverage).toBe(`${Math.min(...years)}/${Math.max(...years)}`);
  });

  it("offers a JSON DataDownload for the index and every election, on the canonical origin", () => {
    const dist = ds.distribution as Array<Record<string, string>>;
    const urls = dist.map((d) => d.contentUrl);
    expect(urls).toContain(`${SITE_URL}/stats/index.json`);
    for (const e of ELECTIONS) {
      expect(urls).toContain(`${SITE_URL}/stats/${e.id}.json`);
    }
    for (const d of dist) {
      expect(d.encodingFormat).toBe("application/json");
      expect(d["@type"]).toBe("DataDownload");
      expect(d.contentUrl.startsWith(SITE_URL + "/stats/")).toBe(true);
    }
  });
});

describe("methodologyHowToGraph", () => {
  const g = methodologyHowToGraph();

  it("is a HowTo with three positioned steps", () => {
    expect(g["@context"]).toBe("https://schema.org");
    expect(g["@type"]).toBe("HowTo");
    const steps = g.step as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(3);
    expect(steps.map((s) => s.position)).toEqual([1, 2, 3]);
    for (const s of steps) {
      expect(s["@type"]).toBe("HowToStep");
      expect(typeof s.name).toBe("string");
      expect(typeof s.text).toBe("string");
    }
  });

  it("builds every step from the shared HOWTO_STEPS the page renders (cannot drift)", () => {
    const steps = g.step as Array<{ name: string; text: string }>;
    expect(steps.map((s) => ({ name: s.name, text: s.text }))).toEqual(HOWTO_STEPS);
  });
});

describe("breadcrumbGraph", () => {
  it("numbers items from 1 and carries name + item URL", () => {
    const g = breadcrumbGraph([
      { name: "Home", url: "https://how2vote.au/" },
      { name: "Parties", url: "https://how2vote.au/2025/parties" },
    ]);
    expect(g["@type"]).toBe("BreadcrumbList");
    const items = g.itemListElement as Array<Record<string, unknown>>;
    expect(items.map((i) => i.position)).toEqual([1, 2]);
    expect(items[1]).toMatchObject({
      "@type": "ListItem",
      name: "Parties",
      item: "https://how2vote.au/2025/parties",
    });
  });
});

describe("faqGraph", () => {
  it("wraps each pair as a Question with an accepted Answer", () => {
    const g = faqGraph([{ question: "Who agrees?", answer: "Party A." }]);
    expect(g["@type"]).toBe("FAQPage");
    const q = (g.mainEntity as Array<Record<string, unknown>>)[0]!;
    expect(q["@type"]).toBe("Question");
    expect(q.name).toBe("Who agrees?");
    expect(q.acceptedAnswer).toEqual({ "@type": "Answer", text: "Party A." });
  });
});

describe("serializeJsonLd", () => {
  it("escapes every '<' so the payload cannot close the script element early", () => {
    const out = serializeJsonLd({ x: "</script><b>" });
    expect(out).not.toContain("<");
    expect(out).toContain("\\u003c/script>");
  });

  it("round-trips to the original object once unescaped", () => {
    const graph = siteGraph();
    const parsed = JSON.parse(serializeJsonLd(graph).replace(/\\u003c/g, "<"));
    expect(parsed).toEqual(graph);
  });
});
