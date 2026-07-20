import { describe, expect, it } from "vitest";
import type { Answer } from "./answers.js";
import {
  decodeShare,
  encodeShare,
  encodeShareV2,
  packAnswers,
  packAnswersById,
  shareElectionId,
  unpackAnswers,
  unpackAnswersById,
} from "./share.js";

const orderedIds = Array.from({ length: 50 }, (_, i) => i + 1);
// A second election with a different question set/ordering, to prove links are election-scoped.
const orderedIds2022 = Array.from({ length: 36 }, (_, i) => i + 100);
const idsFor = (id: string): readonly number[] | undefined =>
  id === "2025" ? orderedIds : id === "2022" ? orderedIds2022 : undefined;

function randomAnswers(seed: number, ids = orderedIds): Answer[] {
  // deterministic pseudo-random answers (no Math.random) for a stable round-trip test
  let x = seed;
  const next = () => (x = (x * 1103515245 + 12345) & 0x7fffffff);
  return ids.map((id) => {
    const points = (next() % 6) as Answer["points"];
    const important = (points === 1 || points === 5) && next() % 2 === 0;
    return { id, points, important };
  });
}

describe("share codec", () => {
  it("round-trips 50 answers exactly", () => {
    const answers = randomAnswers(7);
    const bytes = packAnswers(answers, orderedIds);
    expect(bytes.length).toBe(25); // 50 nibbles → 25 bytes
    expect(unpackAnswers(bytes, orderedIds)).toEqual(answers);
  });

  it("produces a compact fragment carrying the election id", () => {
    const fragment = encodeShare(
      { electorate: "Bean", answers: randomAnswers(1) },
      orderedIds,
      "2025",
    );
    const parts = fragment.split(".");
    expect(parts[0]).toBe("v1");
    expect(parts[1]).toBe("2025");
    expect(parts[2]).toBe("bean");
    expect(parts[3]!.length).toBeLessThanOrEqual(36);
    expect(fragment.length).toBeLessThan(65);
  });

  it("decodes what it encodes, tolerating a leading #", () => {
    const answers = randomAnswers(42);
    const fragment = encodeShare({ electorate: "Melbourne Ports", answers }, orderedIds, "2025");
    const decoded = decodeShare("#" + fragment, idsFor);
    expect(decoded).not.toBeNull();
    expect(decoded!.electionId).toBe("2025");
    expect(decoded!.electorateSlug).toBe("melbourne-ports");
    expect(decoded!.answers).toEqual(answers);
  });

  it("round-trips a different election's question set against its own ordering", () => {
    const answers = randomAnswers(3, orderedIds2022);
    const fragment = encodeShare({ electorate: "Wills", answers }, orderedIds2022, "2022");
    const decoded = decodeShare(fragment, idsFor);
    expect(decoded!.electionId).toBe("2022");
    expect(decoded!.answers).toEqual(answers);
  });

  it("preserves the important flag only where the codec carries it", () => {
    const answers: Answer[] = orderedIds.map((id) => ({ id, points: 5, important: true }));
    const decoded = decodeShare(
      encodeShare({ electorate: "x", answers }, orderedIds, "2025"),
      idsFor,
    );
    expect(decoded!.answers.every((a) => a.points === 5 && a.important)).toBe(true);
  });

  it("returns null for malformed fragments or unknown elections", () => {
    expect(decodeShare("garbage", idsFor)).toBeNull();
    expect(decodeShare("v1.1901.bean.AAAA", idsFor)).toBeNull(); // unknown election
    expect(decodeShare("v1.2025..AAAA", idsFor)).toBeNull(); // empty slug
    expect(decodeShare("v1..bean.AAAA", idsFor)).toBeNull(); // empty election token
    expect(decodeShare("v1.bean.AAAA", idsFor)).toBeNull(); // no election token (3 parts)
  });
});

describe("v2 version-pinned, id-keyed share codec (provisional quiz)", () => {
  // A provisional election whose current dataset vintage is 2028-01-15.
  const provOrdered = [3, 17, 20, 222, 257];
  const idsForProv = (id: string): readonly number[] | undefined =>
    id === "next" ? provOrdered : idsFor(id);
  const versionFor = (id: string): string | undefined => (id === "next" ? "2028-01-15" : undefined);

  const answers: Answer[] = [
    { id: 3, points: 5, important: true },
    { id: 17, points: 2, important: false },
    { id: 20, points: 0, important: false }, // skipped — omitted from payload, restored as skip
    { id: 222, points: 1, important: true },
    { id: 257, points: 4, important: false },
  ];

  it("round-trips answers by policy id when the dataVersion still matches", () => {
    const fragment = encodeShareV2(
      { electorate: "Bean", answers },
      provOrdered,
      "next",
      "2028-01-15",
    );
    expect(fragment.split(".").slice(0, 4)).toEqual(["v2", "next", "2028-01-15", "bean"]);
    const decoded = decodeShare(fragment, idsForProv, versionFor);
    expect(decoded).not.toBeNull();
    expect(decoded!.electionId).toBe("next");
    expect(decoded!.answers).toEqual(answers);
  });

  it("fails closed to null when the quiz has changed (dataVersion mismatch)", () => {
    const fragment = encodeShareV2(
      { electorate: "Bean", answers },
      provOrdered,
      "next",
      "2028-01-15",
    );
    // The provisional quiz has since changed → its current dataVersion is newer.
    const changed = (id: string): string | undefined => (id === "next" ? "2028-02-01" : undefined);
    expect(decodeShare(fragment, idsForProv, changed)).toBeNull();
  });

  it("fails closed when no dataVersion resolver is supplied (cannot verify the pin)", () => {
    const fragment = encodeShareV2(
      { electorate: "Bean", answers },
      provOrdered,
      "next",
      "2028-01-15",
    );
    expect(decodeShare(fragment, idsForProv)).toBeNull();
  });

  it("binds answers to policy ids, not positions: reordering the id list preserves each answer", () => {
    const fragment = encodeShareV2(
      { electorate: "Bean", answers },
      provOrdered,
      "next",
      "2028-01-15",
    );
    // Same id set, different order — an id-keyed codec must still attribute every answer correctly.
    const reordered = [257, 3, 222, 17, 20];
    const decoded = decodeShare(
      fragment,
      (id) => (id === "next" ? reordered : undefined),
      versionFor,
    );
    const byId = new Map(decoded!.answers.map((a) => [a.id, a]));
    for (const a of answers) expect(byId.get(a.id)).toEqual(a);
  });

  it("drops answers whose id is no longer a current question", () => {
    const bytes = packAnswersById(answers, provOrdered);
    // A question set that has dropped id 222 entirely: it must not appear in the reconstruction.
    const shrunk = [3, 17, 20, 257];
    const restored = unpackAnswersById(bytes, shrunk);
    expect(restored.map((a) => a.id)).toEqual(shrunk);
    expect(restored.find((a) => a.id === 3)).toEqual({ id: 3, points: 5, important: true });
  });

  it("shareElectionId reads the election token from a v2 fragment", () => {
    const fragment = encodeShareV2(
      { electorate: "Bean", answers },
      provOrdered,
      "next",
      "2028-01-15",
    );
    expect(shareElectionId(fragment)).toBe("next");
  });
});

describe("share decoder fuzzing — never crash, never leak", () => {
  // A decoded share must ALWAYS be either null or a well-formed result: the codec must never throw on
  // hostile input, and must never hand back an answer set that could poison downstream scoring (wrong
  // length, out-of-range points, a non-boolean flag). The invariants hold for whatever the resolver
  // returns for the embedded election.
  function assertSafe(fragment: string): void {
    let decoded: ReturnType<typeof decodeShare>;
    expect(() => (decoded = decodeShare(fragment, idsFor))).not.toThrow();
    // shareElectionId shares the same parser surface and must also never throw.
    expect(() => shareElectionId(fragment)).not.toThrow();

    const result = decoded!;
    if (result === null) return; // a rejected fragment is the expected safe outcome
    // If it decoded, the answers must be canonical for the resolved election's ordering.
    const ids = idsFor(result.electionId);
    expect(ids).toBeDefined();
    expect(result.answers).toHaveLength(ids!.length);
    for (const a of result.answers) {
      expect(ids).toContain(a.id);
      expect(Number.isInteger(a.points)).toBe(true);
      expect(a.points).toBeGreaterThanOrEqual(0);
      expect(a.points).toBeLessThanOrEqual(5);
      expect(typeof a.important).toBe("boolean");
    }
    expect(result.electionId.length).toBeGreaterThan(0);
    expect(result.electorateSlug.length).toBeGreaterThan(0);
  }

  it("survives a hand-picked corpus of hostile fragments", () => {
    const corpus = [
      "",
      "#",
      ".",
      "....",
      "v1",
      "v1.",
      "v1.2025",
      "v1.2025.bean",
      "v1.2025.bean.", // empty payload
      "v1.2025.bean.****", // non-base64url chars
      "v1.2025.bean.=====", // padding chars (not in our alphabet)
      "v1.2025.bean.  ", // null bytes
      "v1.2025.bean." + "A".repeat(10_000), // over the length cap
      "v1.__proto__.bean.AAAA", // prototype-pollution-shaped election token
      "v1.2025.__proto__.AAAA", // prototype-pollution-shaped slug
      "v1.constructor.prototype.AAAA",
      "v1.__proto__.AAAA",
      "v1.2025.bean.AAAA.extra.parts.here",
      "v1.2025..AAAA",
      "v1..bean.AAAA",
      "V1.2025.bean.AAAA", // wrong-case version
      "v2.2025.bean.AAAA", // pinned token with the default codec's arity → rejected
      "v3.2025.bean.AAAA", // unknown version
      "#v1.2025.bean." + "-_".repeat(200), // valid alphabet, wildly overlong-but-under-cap payload
      "v1.2025.bean.🎉🎉🎉", // emoji / multi-byte
      "javascript:alert(1)",
      "%2e%2e%2f", // encoded traversal
      "v1.2025.bean.\n\r\t",
    ];
    for (const f of corpus) assertSafe(f);
  });

  it("survives thousands of pseudo-random fragments (deterministic)", () => {
    // Deterministic PRNG so a failure is reproducible (no Math.random).
    let x = 0x2545f491;
    const rnd = () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    // A charset skewed toward the tokens that matter (dots, alphabet, delimiters, hostile chars).
    const charset = B64URL + "..### <>%&\\/\"'`{}[]🎉";
    for (let n = 0; n < 5000; n++) {
      const len = Math.floor(rnd() * 80);
      let s = rnd() < 0.5 ? "v1." : rnd() < 0.5 ? "v2." : "";
      for (let i = 0; i < len; i++) s += charset[Math.floor(rnd() * charset.length)];
      assertSafe(s);
    }
  });

  it("never throws when the ordered-id resolver itself throws", () => {
    // Even a caller whose resolver blows up must degrade to null, not propagate the throw.
    const hostileResolver = () => {
      throw new Error("resolver exploded");
    };
    const valid = encodeShare(
      { electorate: "Bean", answers: randomAnswers(5) },
      orderedIds,
      "2025",
    );
    expect(() => decodeShare(valid, hostileResolver)).not.toThrow();
    expect(decodeShare(valid, hostileResolver)).toBeNull();
  });
});

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

describe("shareElectionId", () => {
  it("reads the election token from a v1 fragment (with or without leading #)", () => {
    expect(shareElectionId("v1.2022.bean.AAAA")).toBe("2022");
    expect(shareElectionId("#v1.2019.bean.AAAA")).toBe("2019");
  });

  it("returns null for an empty election token or unrecognised fragment", () => {
    expect(shareElectionId("v1..bean.AAAA")).toBeNull();
    expect(shareElectionId("garbage")).toBeNull();
    expect(shareElectionId("v1.bean.AAAA")).toBeNull(); // no election token (3 parts)
  });
});
