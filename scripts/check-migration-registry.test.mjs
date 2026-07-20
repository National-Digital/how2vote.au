import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { buildRegistry, verify, verifyApplied, sha256 } from "./check-migration-registry.mjs";

const files = () => [
  { name: "0001_research.sql", bytes: "CREATE TABLE a(x);" },
  { name: "0002_more.sql", bytes: "CREATE TABLE b(y);" },
];

const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));

describe("buildRegistry", () => {
  it("pins each migration by sha256, name-sorted", () => {
    const reg = buildRegistry([files()[1], files()[0]]);
    expect(reg.migrations.map((m) => m.file)).toEqual(["0001_research.sql", "0002_more.sql"]);
    expect(reg.migrations[0].sha256).toBe(sha256("CREATE TABLE a(x);"));
  });
});

describe("verify — committed drift", () => {
  it("passes when the registry matches on-disk files", () => {
    const reg = buildRegistry(files());
    expect(verify(reg, files()).ok).toBe(true);
  });

  it("FAILS when a migration's bytes changed (checksum drift)", () => {
    const reg = buildRegistry(files());
    const edited = files();
    edited[0].bytes = "CREATE TABLE a(x, z);";
    expect(hasError(verify(reg, edited), "checksum drifted")).toBe(true);
  });

  it("FAILS when a new migration is not pinned", () => {
    const reg = buildRegistry(files());
    const added = [...files(), { name: "0003_new.sql", bytes: "CREATE TABLE c(z);" }];
    expect(hasError(verify(reg, added), "is not pinned")).toBe(true);
  });

  it("FAILS when a pinned migration is missing on disk", () => {
    const reg = buildRegistry(files());
    expect(hasError(verify(reg, [files()[0]]), "is missing on disk")).toBe(true);
  });

  it("FAILS on an invalid migration filename", () => {
    const reg = buildRegistry([{ name: "nope.sql", bytes: "x" }]);
    expect(hasError(verify(reg, [{ name: "nope.sql", bytes: "x" }]), "valid NNNN_name.sql")).toBe(
      true,
    );
  });

  it("fails closed with no migrations", () => {
    expect(hasError(verify(buildRegistry([]), []), "no migration .sql files found")).toBe(true);
  });
});

describe("verifyApplied — live drift", () => {
  const reg = () => buildRegistry(files());

  it("passes when the applied set equals the registry set", () => {
    expect(verifyApplied(reg(), ["0001_research.sql", "0002_more.sql"]).ok).toBe(true);
  });

  it("FAILS when a pinned migration is not applied", () => {
    expect(hasError(verifyApplied(reg(), ["0001_research.sql"]), "is NOT applied")).toBe(true);
  });

  it("FAILS when the live DB has an unpinned migration", () => {
    const res = verifyApplied(reg(), ["0001_research.sql", "0002_more.sql", "0003_rogue.sql"]);
    expect(hasError(res, "unpinned migration")).toBe(true);
  });

  it("fails closed on an empty applied list", () => {
    expect(hasError(verifyApplied(reg(), []), "cannot verify")).toBe(true);
  });
});

describe("the real committed registry", () => {
  it("matches the on-disk migrations", () => {
    const root = new URL("..", import.meta.url);
    const dir = new URL("apps/web/migrations/", root);
    const onDisk = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((name) => ({ name, bytes: readFileSync(new URL(name, dir)) }));
    const registry = JSON.parse(
      readFileSync(new URL("infra/providers/cloudflare/migration-registry.json", root), "utf8"),
    );
    expect(verify(registry, onDisk).errors).toEqual([]);
  });
});
