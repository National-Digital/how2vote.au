import { describe, expect, it } from "vitest";
import { iosPhased, markers, playFraction } from "./rollout-markers.mjs";

const pr = (title, n = 70) =>
  `* ${title} by @cameron in https://github.com/National-Digital/how2vote.au/pull/${n}`;
const notes = (...lines) =>
  [
    "## What's Changed",
    ...lines,
    "",
    "**Full Changelog**: https://github.com/o/r/compare/a...b",
  ].join("\n");

describe("markers", () => {
  it("reads a marker standing in a pull request title", () => {
    expect(markers(notes(pr("fix(data): correct the Senate ballot [full-rollout]")))).toEqual({
      full: true,
      staged: false,
    });
    expect(markers(notes(pr("[staged-rollout] feat(ios): new shell")))).toEqual({
      full: false,
      staged: true,
    });
    expect(
      markers(notes(`- fix: x [FULL-ROLLOUT] by @dependabot[bot] in https://github.com/o/r/pull/3`))
        .full,
    ).toBe(true);
  });

  it("reads a marker alone on its own line", () => {
    expect(markers(`[full-rollout]\n\n${notes(pr("fix: a"))}`).full).toBe(true);
    expect(markers(notes(pr("fix: a"), "  [staged-rollout]  ")).staged).toBe(true);
  });

  it("ignores a marker that is only mentioned", () => {
    for (const body of [
      notes(pr("docs: explain the `[full-rollout]` marker")),
      notes(pr("ci: rename x[full-rollout] handling")),
      "Add [full-rollout] to disable phased release.",
      notes(pr("fix: a"), "Use [full-rollout] for data corrections."),
      "* fix: a [full-rollout] by someone elsewhere",
      "- [full-rollout]-like",
    ]) {
      expect(markers(body), body).toEqual({ full: false, staged: false });
    }
  });

  it("is empty for empty notes", () => {
    expect(markers("")).toEqual({ full: false, staged: false });
    expect(markers(undefined)).toEqual({ full: false, staged: false });
  });
});

describe("playFraction and iosPhased", () => {
  it("defaults to a full Play rollout and a phased iOS release", () => {
    expect(playFraction(notes(pr("fix: a")))).toBe("1");
    expect(iosPhased(notes(pr("fix: a")))).toBe(true);
  });

  it("stages Play only with [staged-rollout], and leaves iOS phased", () => {
    const body = notes(pr("feat(ios): risky [staged-rollout]"));
    expect(playFraction(body)).toBe("0.1");
    expect(iosPhased(body)).toBe(true);
  });

  it("lets [full-rollout] win and turn the phased release off", () => {
    const body = notes(pr("fix: a [staged-rollout]"), pr("fix(data): b [full-rollout]", 71));
    expect(playFraction(body)).toBe("1");
    expect(iosPhased(body)).toBe(false);
  });
});
