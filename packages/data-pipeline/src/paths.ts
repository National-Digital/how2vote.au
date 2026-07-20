import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root, resolved from this file's location (packages/data-pipeline/src). */
export const REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
export const DATA_DIR = resolve(REPO_ROOT, "data");

/** Per-election on-disk layout. `id` is the election slug (e.g. "2025"). */
export function electionPaths(id: string) {
  return {
    /** v0 ODbL source data for this election (committed seed, snapshotted per cycle). */
    v0SeedDir: resolve(DATA_DIR, "v0-seed", id),
    /** Hand-curated source of record (committed). */
    source: {
      questions: resolve(DATA_DIR, "source", id, "questions.json"),
      parties: resolve(DATA_DIR, "source", id, "parties.json"),
      ballots: resolve(DATA_DIR, "source", id, "ballots.json"),
    },
    /** Build-ready, checksummed bundle the app imports (committed). */
    dist: {
      dataset: resolve(DATA_DIR, "dist", id, "dataset.json"),
      manifest: resolve(DATA_DIR, "dist", id, "manifest.json"),
    },
    /**
     * The committed, immutable TVFY snapshot store (ADR 0005): the record each election's
     * questions compile from, versioned and locked at the declaration of nominations.
     */
    snapshot: {
      dir: resolve(DATA_DIR, "snapshots/tvfy", id),
      versions: resolve(DATA_DIR, "snapshots/tvfy", id, "versions.json"),
      versionDir: (version: number) => resolve(DATA_DIR, "snapshots/tvfy", id, `v${version}`),
    },
  } as const;
}

/** Paths inside one snapshot version directory. */
export function snapshotVersionPaths(id: string, version: number) {
  const dir = electionPaths(id).snapshot.versionDir(version);
  return {
    dir,
    meta: resolve(dir, "meta.json"),
    policiesList: resolve(dir, "policies-list.json"),
    policiesDir: resolve(dir, "policies"),
    policy: (policyId: number) => resolve(dir, "policies", `${policyId}.json`),
    ballots: resolve(dir, "ballots.json"),
  } as const;
}

export const paths = {
  /** Raw upstream fetches (git-ignored, reproducible). */
  raw: {
    tvfyPolicies: resolve(DATA_DIR, "raw/tvfy-policies.json"),
    tvfyDir: resolve(DATA_DIR, "raw/tvfy"),
  },
  /** Full compiled TVFY position matrix — a reproducible artifact (regenerate with
   *  `pnpm data:compile`); not committed. */
  compiled: resolve(DATA_DIR, "compiled/positions.json"),
  /** The election index the app reads to drive the toggle. */
  electionsIndex: resolve(DATA_DIR, "dist", "elections.json"),
} as const;

export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

/** Writes JSON deterministically (stable 2-space formatting, trailing newline). */
export async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/** SHA-256 of a value's canonical JSON form — the dataset's tamper-evident checksum. */
export function checksum(data: unknown): string {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}
