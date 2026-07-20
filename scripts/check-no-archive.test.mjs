import { describe, expect, it } from "vitest";
import { verdict } from "./check-no-archive.mjs";

const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));

describe("verdict — no-archive scan", () => {
  it("passes on clean sources", () => {
    const res = verdict([
      {
        path: "packages/data-pipeline/src/tvfy.ts",
        text: "const base = 'theyvoteforyou.org.au/api/v1';",
      },
      { path: "data/snapshots/tvfy/2019/v1/meta.json", text: '{"source":"tvfy-api"}' },
    ]);
    expect(res.ok).toBe(true);
  });

  it("flags an archive.org URL", () => {
    expect(
      hasError(
        verdict([{ path: "x.ts", text: "fetch('https://web.archive.org/web/x')" }]),
        "archive.org",
      ),
    ).toBe(true);
  });

  it("flags an IA_S3 env var", () => {
    expect(
      hasError(verdict([{ path: "x.ts", text: "process.env.IA_S3_ACCESS_KEY" }]), "S3 env var"),
    ).toBe(true);
  });

  it('flags the "wayback-backfill" source value', () => {
    expect(
      hasError(
        verdict([{ path: "m.json", text: '{"source":"wayback-backfill"}' }]),
        "wayback-backfill",
      ),
    ).toBe(true);
  });

  it("flags a retired snapshot:archive / snapshot:backfill command", () => {
    expect(
      hasError(verdict([{ path: "package.json", text: '"snapshot:archive": "x"' }]), "command"),
    ).toBe(true);
    expect(
      hasError(verdict([{ path: "package.json", text: '"snapshot:backfill": "x"' }]), "command"),
    ).toBe(true);
  });

  it("flags an archives.json reference and a bare Wayback / SavePageNow / CdxClient mention", () => {
    expect(
      hasError(verdict([{ path: "x.ts", text: "readJson('archives.json')" }]), "archives.json"),
    ).toBe(true);
    expect(hasError(verdict([{ path: "x.ts", text: "// Wayback capture" }]), "Wayback")).toBe(true);
    expect(
      hasError(verdict([{ path: "x.ts", text: "new SavePageNowClient()" }]), "SavePageNow"),
    ).toBe(true);
    expect(hasError(verdict([{ path: "x.ts", text: "new CdxClient()" }]), "CDX")).toBe(true);
  });
});
