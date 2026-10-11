import { describe, expect, it } from "vitest";
import { parseTagRecords, TRAILER, trustedRecords } from "./store-release-scope.mjs";
import {
  appStoreContext,
  catchUpCandidates,
  inFlightTags,
  latestState,
  MAX_CANDIDATES,
  parkedAtGate,
  parkedCatchUps,
  runTag,
  staleRuns,
  SUBMIT_JOB,
  turnHolder,
} from "./supersede-store-runs.mjs";

/** for-each-ref output in TAG_FORMAT: [tag, annotated, commit, decision]. */
const tags = (...list) =>
  parseTagRecords(
    list
      .map(([tag, annotated, commit, decision]) =>
        annotated
          ? `${tag}\x1ftag\x1fobj-${tag}\x1f${commit}\x1f${tag}\n\n${TRAILER}: ${decision}\n\x1e`
          : `${tag}\x1fcommit\x1f${commit}\x1f\x1fsubject\x1e`,
      )
      .join("\n"),
  );

describe("runTag", () => {
  it("reads the release from a run-name", () => {
    expect(runTag("iOS release v1.5.0")).toBe("1.5.0");
    expect(runTag("Android release v12.3.40")).toBe("12.3.40");
  });

  it("ignores dry runs and runs without a release", () => {
    expect(runTag("iOS release v1.5.0 (dry run)")).toBeNull();
    expect(runTag("iOS release main (dry run)")).toBeNull();
    expect(runTag("iOS release")).toBeNull();
    expect(runTag("iOS release v1.5")).toBeNull();
    expect(runTag("iOS release xv1.5.0")).toBeNull();
    expect(runTag(undefined)).toBeNull();
  });
});

describe("staleRuns", () => {
  const run = (id, title, status = "waiting") => ({ id, status, display_title: title });
  const gated = [{ status: "completed" }, { status: "waiting" }];

  it("cancels older runs waiting at a gate", () => {
    const runs = [
      run(1, "iOS release v1.4.9"),
      run(2, "iOS release v1.5.0"),
      run(9, "iOS release v1.5.1"),
    ];
    const jobs = new Map([
      [1, gated],
      [2, gated],
      [9, gated],
    ]);
    expect(staleRuns({ runs, jobs, version: "1.5.1", runId: 9 })).toEqual([
      { id: 1, version: "1.4.9" },
      { id: 2, version: "1.5.0" },
    ]);
  });

  it("never cancels itself, a newer or equal release, or a dry run", () => {
    const runs = [
      run(9, "iOS release v1.4.0"),
      run(3, "iOS release v1.6.0"),
      run(4, "iOS release v1.5.1"),
      run(5, "iOS release v1.4.0 (dry run)"),
    ];
    const jobs = new Map(runs.map((r) => [r.id, gated]));
    expect(staleRuns({ runs, jobs, version: "1.5.1", runId: 9 })).toEqual([]);
  });

  it("compares versions numerically", () => {
    const runs = [run(1, "iOS release v1.10.0"), run(2, "iOS release v1.9.0")];
    const jobs = new Map(runs.map((r) => [r.id, gated]));
    expect(staleRuns({ runs, jobs, version: "1.10.1", runId: 9 }).map((r) => r.id)).toEqual([1, 2]);
    expect(staleRuns({ runs, jobs, version: "1.9.5", runId: 9 }).map((r) => r.id)).toEqual([2]);
  });

  it("leaves a run alone while any of its jobs is still executing", () => {
    const runs = [run(1, "Android release v1.5.0")];
    for (const busy of ["in_progress", "queued", "pending"]) {
      const jobs = new Map([[1, [{ status: busy }, { status: "waiting" }]]]);
      expect(staleRuns({ runs, jobs, version: "1.5.1", runId: 9 }), busy).toEqual([]);
    }
  });

  it("requires the run to be waiting, with a job waiting", () => {
    const jobs = new Map([[1, [{ status: "completed" }]]]);
    expect(
      staleRuns({ runs: [run(1, "iOS release v1.5.0")], jobs, version: "1.5.1", runId: 9 }),
    ).toEqual([]);
    expect(
      staleRuns({
        runs: [run(1, "iOS release v1.5.0", "in_progress")],
        jobs: new Map([[1, gated]]),
        version: "1.5.1",
        runId: 9,
      }),
    ).toEqual([]);
    expect(
      staleRuns({
        runs: [run(1, "iOS release v1.5.0")],
        jobs: new Map(),
        version: "1.5.1",
        runId: 9,
      }),
    ).toEqual([]);
  });
});

describe("parkedCatchUps", () => {
  it("cancels every parked catch-up run but this one", () => {
    const runs = [
      { id: 1, status: "waiting" },
      { id: 2, status: "waiting" },
      { id: 3, status: "in_progress" },
      { id: 9, status: "waiting" },
    ];
    const jobs = new Map([
      [1, [{ status: "completed" }, { status: "waiting" }]],
      [2, [{ status: "in_progress" }, { status: "waiting" }]],
      [3, [{ status: "waiting" }]],
      [9, [{ status: "waiting" }]],
    ]);
    expect(parkedCatchUps({ runs, jobs, runId: 9 })).toEqual([1]);
  });
});

describe("turnHolder", () => {
  const job = (id, started, status = "in_progress", name = `${SUBMIT_JOB} / ${SUBMIT_JOB}`) => ({
    id,
    name,
    status,
    started_at: started,
  });

  it("waits for a running submit job that started earlier", () => {
    const jobs = [job(5, "2026-10-11T00:00:00Z"), job(7, "2026-10-11T00:01:00Z")];
    expect(turnHolder(jobs, 7)?.id).toBe(5);
    expect(turnHolder(jobs, 5)).toBeNull();
  });

  it("breaks a start-time tie by job id", () => {
    const jobs = [job(8, "2026-10-11T00:00:00Z"), job(6, "2026-10-11T00:00:00Z")];
    expect(turnHolder(jobs, 8)?.id).toBe(6);
    expect(turnHolder(jobs, 6)).toBeNull();
  });

  it("ignores jobs parked at the gate, finished, or not submit jobs", () => {
    const jobs = [
      job(1, null, "waiting"),
      job(2, "2026-10-11T00:00:00Z", "completed"),
      job(3, "2026-10-11T00:00:00Z", "in_progress", "Build & TestFlight"),
      job(9, "2026-10-11T00:05:00Z"),
    ];
    expect(turnHolder(jobs, 9)).toBeNull();
  });

  it("does not hold a job that cannot find itself", () => {
    expect(turnHolder([job(5, "2026-10-11T00:00:00Z")], 7)).toBeNull();
  });
});

describe("inFlightTags", () => {
  it("lists the releases of runs not yet completed, without dry runs", () => {
    expect(
      inFlightTags([
        { status: "waiting", display_title: "iOS release v1.5.1" },
        { status: "in_progress", display_title: "iOS release v1.5.2 (dry run)" },
        { status: "completed", display_title: "iOS release v1.5.0" },
        { status: "queued", display_title: "iOS release main" },
      ]),
    ).toEqual(["v1.5.1"]);
  });
});

describe("parkedAtGate", () => {
  it("is true only when a job waits and every other job has completed", () => {
    expect(parkedAtGate([{ status: "completed" }, { status: "waiting" }])).toBe(true);
    expect(parkedAtGate([{ status: "waiting" }])).toBe(true);
    expect(parkedAtGate([{ status: "completed" }])).toBe(false);
    expect(parkedAtGate([{ status: "in_progress" }, { status: "waiting" }])).toBe(false);
    expect(parkedAtGate([])).toBe(false);
  });

  it("ignores the alert job queued behind the gate, and nothing else", () => {
    for (const status of ["queued", "pending"]) {
      for (const name of [
        "Report failures / Open, update or close the failure issue",
        "Report failures",
      ]) {
        const alert = { status, name };
        expect(parkedAtGate([{ status: "completed" }, { status: "waiting" }, alert]), name).toBe(
          true,
        );
        expect(parkedAtGate([alert]), name).toBe(false);
      }
      expect(
        parkedAtGate([{ status: "waiting" }, { status, name: "Publish the F-Droid APK" }]),
      ).toBe(false);
      expect(parkedAtGate([{ status: "waiting" }, { status, name: "Report failures later" }])).toBe(
        false,
      );
    }
  });
});

describe("latestState", () => {
  it("takes the newest status for the context", () => {
    const statuses = [
      { context: "fdroid-apk/v1.5.0", state: "success" },
      { context: appStoreContext("v1.5.0"), state: "success" },
      { context: appStoreContext("v1.5.0"), state: "pending" },
    ];
    expect(latestState(statuses, "app-store/v1.5.0")).toBe("success");
    expect(latestState(statuses, "app-store/v1.4.0")).toBeNull();
  });
});

describe("catchUpCandidates", () => {
  const records = tags(
    ["v1.5.3", true, "c5", "skip"],
    ["v1.5.2", true, "c4", "ship"],
    ["v1.5.1", true, "c3", "ship"],
    ["v1.5.0", true, "c2", "skip"],
    ["v1.4.6", false, "c1"],
  );

  it("lists the shipped releases, newest first", () => {
    expect(catchUpCandidates({ records, requested: "" }).candidates.map((r) => r.tag)).toEqual([
      "v1.5.2",
      "v1.5.1",
      "v1.4.6",
    ]);
  });

  it("offers at most MAX_CANDIDATES", () => {
    const many = tags(
      ...Array.from({ length: MAX_CANDIDATES + 5 }, (_, i) => [
        `v1.${30 - i}.0`,
        true,
        `c${i}`,
        "ship",
      ]),
    );
    expect(catchUpCandidates({ records: many, requested: "" }).candidates).toHaveLength(
      MAX_CANDIDATES,
    );
  });

  it("offers a requested release on its own, shipped or not", () => {
    expect(catchUpCandidates({ records, requested: "v1.5.0" })).toEqual({
      candidates: [records.find((r) => r.tag === "v1.5.0")],
    });
    expect(catchUpCandidates({ records, requested: "v9.9.9" }).reason).toContain(
      "not a trusted release tag on main",
    );
  });

  it("does nothing before any release has shipped", () => {
    expect(
      catchUpCandidates({
        records: tags(["v1.0.0", true, "c1", "skip"]),
        requested: "",
        inFlight: false,
      }),
    ).toEqual({ reason: "no release has shipped the apps" });
  });

  it("never offers a hand-made lightweight tag newer than the first annotated release", () => {
    const all = tags(
      ["v1.6.0", false, "hand"],
      ["v1.5.1", true, "c3", "ship"],
      ["v1.4.6", false, "c1"],
    );
    const trusted = trustedRecords(all, (ancestor) => ancestor === "c1");
    expect(
      catchUpCandidates({ records: trusted, requested: "" }).candidates.map((r) => r.tag),
    ).toEqual(["v1.5.1", "v1.4.6"]);
    expect(catchUpCandidates({ records: trusted, requested: "v1.6.0" }).reason).toContain(
      "not a trusted release tag",
    );
  });
});
