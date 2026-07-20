import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ELECTIONS } from "@how2vote/data-schema";
import { datasetFor } from "./content.server";
import { loadData } from "./data";
import { manifestFor } from "./manifest";

/**
 * The config-only guarantee (docs/adding-an-election.md): adding an election is DATA + REGISTRY only,
 * with no per-election code edit. These tests fail closed if that ever regresses — either because a
 * new election in ELECTIONS is not picked up by the data-driven wiring, or because someone reintroduces
 * a hand-maintained per-election import that a new election would silently miss.
 */

const LIB = dirname(fileURLToPath(import.meta.url));

describe("every registered election is served without a per-election code edit", () => {
  for (const meta of ELECTIONS) {
    describe(meta.id, () => {
      // dataVersion is unique per election, so a wrong/fallback resolution would mismatch here — the
      // assertions prove the correct election resolved, not merely that *something* came back.
      it("resolves its manifest (not the current-election fallback)", () => {
        expect(manifestFor(meta.id).dataVersion).toBe(meta.dataVersion);
      });

      it("resolves its server-side content dataset", () => {
        expect(datasetFor(meta.id)?.questions.dataVersion).toBe(meta.dataVersion);
      });

      it("lazy-loads its client dataset chunk", async () => {
        const data = await loadData(meta.id);
        expect(data.dataset.questions.dataVersion).toBe(meta.dataVersion);
      });
    });
  }
});

describe("the per-election wiring is data-driven, not hand-maintained", () => {
  // These three modules are the only places that pull a dataset/manifest keyed by election. Each must
  // use a glob / templated specifier — "$data/dist/*/…" or `$data/dist/${id}/…` — never a hardcoded
  // per-election specifier like "$data/dist/2025/…", which is exactly what a new election would
  // silently miss. Only the `$data` alias with a literal digit after `dist/` is a real import
  // specifier; a `*` or `${…}` there is the data-driven form, and plain doc prose ("/data/dist/2025")
  // has no `$` so it is not flagged.
  for (const file of ["data.ts", "manifest.ts", "content.server.ts"]) {
    it(`${file} contains no hardcoded per-election dataset/manifest import`, () => {
      const src = readFileSync(resolve(LIB, file), "utf8");
      const hardcoded = src.match(/\$data\/dist\/\d[^"'`)]*/g) ?? [];
      expect(hardcoded).toEqual([]);
    });
  }
});
