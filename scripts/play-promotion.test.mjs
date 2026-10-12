import { describe, expect, it } from "vitest";
import { decidePromotion, readTracks } from "./play-promotion.mjs";

const release = (status, code, extra = {}) => ({ status, versionCodes: [String(code)], ...extra });
const internal = [release("completed", 105001007)];

describe("decidePromotion", () => {
  it("promotes a build on the internal track over an older completed release", () => {
    expect(
      decidePromotion({
        code: "105001007",
        production: [release("completed", 105000003)],
        internal,
      }),
    ).toEqual({ action: "promote", reason: "promoting 105001007" });
    expect(decidePromotion({ code: "105001007", production: [], internal }).action).toBe("promote");
  });

  it("names the older staged rollout it replaces", () => {
    for (const status of ["inProgress", "halted"]) {
      const d = decidePromotion({
        code: "105001007",
        production: [
          release("completed", 105000003),
          release(status, 105000004, { name: "1.5.0", userFraction: 0.1 }),
        ],
        internal,
      });
      expect(d.action, status).toBe("promote");
      expect(d.supersedes, status).toBe(`1.5.0 (${status} 10%)`);
    }
  });

  it("skips a build production already holds, in any status", () => {
    for (const status of ["draft", "inProgress", "halted", "completed"]) {
      const d = decidePromotion({
        code: "105001007",
        production: [release(status, 105001007)],
        internal,
      });
      expect(d.action, status).toBe("skip");
      expect(d.reason, status).toContain("already holds");
    }
  });

  it("skips when production holds a newer build", () => {
    const d = decidePromotion({
      code: "105000004",
      production: [release("inProgress", 105001007, { name: "1.5.1", userFraction: 0.1 })],
      internal: [release("completed", 105000004)],
    });
    expect(d).toEqual({
      action: "skip",
      reason:
        "production holds a newer build: 1.5.1 (inProgress 10%); promote the newest run or re-dispatch it",
    });
  });

  it("skips when the internal track holds a newer build", () => {
    const d = decidePromotion({
      code: "105000004",
      production: [release("completed", 105000003)],
      internal: [release("completed", 105001007, { name: "1.5.1" })],
    });
    expect(d).toEqual({
      action: "skip",
      reason:
        "the internal track holds a newer build: 1.5.1 (completed); promote the newest run or re-dispatch it",
    });
  });

  it("fails when the build is not on the internal track", () => {
    expect(
      decidePromotion({
        code: "105001007",
        production: [],
        internal: [release("completed", 105001006)],
      }),
    ).toEqual({
      action: "fail",
      reason: "build 105001007 is not on the internal track",
    });
  });
});

describe("readTracks", () => {
  const fake = (tracks, { insert = { id: "e1" } } = {}) => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push(
        `${init.method ?? "GET"} ${url.replace(/^.*applications\/au\.how2vote\.app/, "")}`,
      );
      if (init.method === "POST") return { ok: true, status: 200, json: async () => insert };
      if (init.method === "DELETE") return { ok: true, status: 204 };
      const name = url.split("/").pop();
      const t = tracks[name];
      if (t === undefined) return { ok: false, status: 404 };
      if (typeof t === "number") return { ok: false, status: t };
      return { ok: true, status: 200, json: async () => ({ releases: t }) };
    };
    return { fetchImpl, calls };
  };

  it("reads both tracks and deletes the edit", async () => {
    const { fetchImpl, calls } = fake({ production: [release("completed", 1)], internal });
    await expect(readTracks(fetchImpl, "t")).resolves.toEqual({
      production: [release("completed", 1)],
      internal,
    });
    expect(calls.at(-1)).toBe("DELETE /edits/e1");
  });

  it("treats a missing track as empty", async () => {
    const { fetchImpl } = fake({ internal });
    await expect(readTracks(fetchImpl, "t")).resolves.toEqual({ production: [], internal });
  });

  it("deletes the edit when a read fails", async () => {
    const { fetchImpl, calls } = fake({ production: 500, internal });
    await expect(readTracks(fetchImpl, "t")).rejects.toThrow("production track unreadable: 500");
    expect(calls.at(-1)).toBe("DELETE /edits/e1");
  });

  it("fails when no edit can be opened", async () => {
    const { fetchImpl } = fake({}, { insert: { error: { message: "denied" } } });
    await expect(readTracks(fetchImpl, "t")).rejects.toThrow(
      "Play refused to open an edit: denied",
    );
  });
});
