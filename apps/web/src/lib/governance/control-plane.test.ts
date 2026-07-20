/**
 * Incident-rehearsal suite for the runtime kill-switch control plane.
 *
 * REQUIRED, BLOCKING rehearsals. Each proves that suspending a scope makes the runtime REFUSE the
 * capability (fail closed) AND that lifting the suspension safely RESTORES it — the six mandated
 * scenarios (wrong ballot, mapping dispute, data poisoning, revoked print approval, correction
 * banner, restore) plus every remaining scope and the tamper/unsigned fail-closed guarantee.
 *
 * The pure core is driven with plain objects re-signed for each case, so the switch is exercised
 * end-to-end without a real deploy.
 */
import { describe, expect, it } from "vitest";
import {
  capabilityVerdict,
  controlPlaneDigest,
  hasCorrectionNotice,
  isAllowed,
  isTampered,
  mappingSuspendedPartyKeys,
  suspendedPropositionIds,
  type Capability,
  type ControlPlane,
  type Suspension,
} from "./control-plane";

const AUDIT = { reason: "incident-rehearsal", by: "ops", flaggedAt: "2026-07-16" };

/** A correctly-signed control plane over the given suspensions. */
function signed(suspensions: Suspension[]): ControlPlane {
  const body = { schemaVersion: 1, suspensions };
  return { schemaVersion: 1, suspensions, integrity: controlPlaneDigest(body) };
}

/** Re-sign a plane with the same entries but the given ones marked lifted (a RESTORE). */
function lifted(suspensions: Suspension[]): ControlPlane {
  return signed(suspensions.map((s) => ({ ...s, liftedAt: "2026-07-17", liftedBy: "ops" })));
}

const EMPTY = signed([]);

describe("control plane — baseline", () => {
  it("allows every capability when nothing is suspended", () => {
    const caps: Capability[] = [
      { kind: "research" },
      { kind: "publication" },
      { kind: "printing", electionId: "2025", electorate: "bean" },
      { kind: "decoding", electionId: "2025" },
      { kind: "election", electionId: "2025" },
      { kind: "chamber", electionId: "2025", chamber: "house" },
      { kind: "electorate", electionId: "2025", electorate: "bean" },
      { kind: "ballot", electionId: "2025", chamber: "senate", ballot: "NSW" },
      { kind: "proposition", electionId: "2025", propositionId: 11 },
      { kind: "map", mapId: "2025/NSW" },
    ];
    for (const c of caps) expect(isAllowed(EMPTY, c)).toBe(true);
    expect(isTampered(EMPTY)).toBe(false);
  });
});

describe("rehearsal: revoked print approval (printing scope)", () => {
  const cap: Capability = { kind: "printing", electionId: "2025", electorate: "bean" };
  it("suspend ⇒ printing refused", () => {
    const plane = signed([{ scope: "printing", ...AUDIT, reason: "print approval revoked" }]);
    const v = capabilityVerdict(plane, cap);
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain("print approval revoked");
  });
  it("restore (lift) ⇒ printing allowed again", () => {
    const plane = lifted([{ scope: "printing", ...AUDIT }]);
    expect(isAllowed(plane, cap)).toBe(true);
  });
});

describe("rehearsal: mapping dispute (mapping scope subsumes corrections)", () => {
  it("suspend ⇒ the disputed party alignment is withdrawn", () => {
    const plane = signed([
      { scope: "mapping", electionId: "2025", partyKey: "australian_greens", ...AUDIT },
    ]);
    expect(mappingSuspendedPartyKeys(plane, "2025")).toEqual(new Set(["australian_greens"]));
    expect(hasCorrectionNotice(plane, "2025")).toBe(true);
  });
  it("restore ⇒ the alignment returns and the banner clears", () => {
    const plane = lifted([
      { scope: "mapping", electionId: "2025", partyKey: "australian_greens", ...AUDIT },
    ]);
    expect(mappingSuspendedPartyKeys(plane, "2025").size).toBe(0);
    expect(hasCorrectionNotice(plane, "2025")).toBe(false);
  });
});

describe("rehearsal: correction banner shown", () => {
  it("a granular suspension raises the under-review banner; a global one does not", () => {
    const granular = signed([
      { scope: "proposition", electionId: "2025", propositionId: 11, ...AUDIT },
    ]);
    expect(hasCorrectionNotice(granular, "2025")).toBe(true);
    // A global printing suspension is not a per-card correction, so no under-review banner.
    const global = signed([{ scope: "printing", ...AUDIT }]);
    expect(hasCorrectionNotice(global, "2025")).toBe(false);
  });
});

describe("rehearsal: wrong ballot (ballot / chamber scope)", () => {
  const cap: Capability = { kind: "ballot", electionId: "2025", chamber: "senate", ballot: "NSW" };
  it("suspend the specific ballot ⇒ that ballot refused, a sibling stays available", () => {
    const plane = signed([
      { scope: "ballot", electionId: "2025", chamber: "senate", ballot: "NSW", ...AUDIT },
    ]);
    expect(isAllowed(plane, cap)).toBe(false);
    expect(
      isAllowed(plane, { kind: "ballot", electionId: "2025", chamber: "senate", ballot: "VIC" }),
    ).toBe(true);
  });
  it("suspending the whole chamber refuses every ballot in it", () => {
    const plane = signed([{ scope: "chamber", electionId: "2025", chamber: "senate", ...AUDIT }]);
    expect(isAllowed(plane, cap)).toBe(false);
    expect(isAllowed(plane, { kind: "chamber", electionId: "2025", chamber: "house" })).toBe(true);
  });
  it("restore ⇒ the ballot is available again", () => {
    const plane = lifted([
      { scope: "ballot", electionId: "2025", chamber: "senate", ballot: "NSW", ...AUDIT },
    ]);
    expect(isAllowed(plane, cap)).toBe(true);
  });
});

describe("rehearsal: data poisoning (research + publication scopes)", () => {
  it("suspend ⇒ ingestion and publication both refused", () => {
    const plane = signed([
      { scope: "research", ...AUDIT, reason: "suspected ingestion poisoning" },
      { scope: "publication", ...AUDIT, reason: "suspected ingestion poisoning" },
    ]);
    expect(isAllowed(plane, { kind: "research" })).toBe(false);
    expect(isAllowed(plane, { kind: "publication" })).toBe(false);
  });
  it("restore ⇒ ingestion and publication resume", () => {
    const plane = lifted([
      { scope: "research", ...AUDIT },
      { scope: "publication", ...AUDIT },
    ]);
    expect(isAllowed(plane, { kind: "research" })).toBe(true);
    expect(isAllowed(plane, { kind: "publication" })).toBe(true);
  });
});

describe("rehearsal: proposition excluded", () => {
  it("suspend ⇒ the proposition is excluded from scoring", () => {
    const plane = signed([
      { scope: "proposition", electionId: "2025", propositionId: 32, ...AUDIT },
    ]);
    expect(suspendedPropositionIds(plane, "2025")).toEqual(new Set([32]));
    expect(isAllowed(plane, { kind: "proposition", electionId: "2025", propositionId: 32 })).toBe(
      false,
    );
    expect(isAllowed(plane, { kind: "proposition", electionId: "2025", propositionId: 11 })).toBe(
      true,
    );
  });
  it("restore ⇒ the proposition scores again", () => {
    const plane = lifted([
      { scope: "proposition", electionId: "2025", propositionId: 32, ...AUDIT },
    ]);
    expect(suspendedPropositionIds(plane, "2025").size).toBe(0);
  });
});

describe("scope hierarchy: suspending an election cascades", () => {
  const plane = signed([{ scope: "election", electionId: "2025", ...AUDIT }]);
  it("refuses the election and every capability under it, but leaves other elections alone", () => {
    expect(isAllowed(plane, { kind: "election", electionId: "2025" })).toBe(false);
    expect(isAllowed(plane, { kind: "printing", electionId: "2025", electorate: "bean" })).toBe(
      false,
    );
    expect(isAllowed(plane, { kind: "decoding", electionId: "2025" })).toBe(false);
    expect(isAllowed(plane, { kind: "chamber", electionId: "2025", chamber: "house" })).toBe(false);
    expect(isAllowed(plane, { kind: "electorate", electionId: "2025", electorate: "bean" })).toBe(
      false,
    );
    expect(
      isAllowed(plane, { kind: "ballot", electionId: "2025", chamber: "senate", ballot: "NSW" }),
    ).toBe(false);
    expect(isAllowed(plane, { kind: "proposition", electionId: "2025", propositionId: 11 })).toBe(
      false,
    );
    // A different election is untouched.
    expect(isAllowed(plane, { kind: "election", electionId: "2022" })).toBe(true);
  });
});

describe("rehearsal: decoding and electorate scopes", () => {
  it("global decoding suspension refuses share-link decode", () => {
    const plane = signed([{ scope: "decoding", ...AUDIT }]);
    expect(isAllowed(plane, { kind: "decoding", electionId: "2025" })).toBe(false);
    expect(isAllowed(plane, { kind: "decoding" })).toBe(false);
  });
  it("electorate suspension refuses printing for that electorate only", () => {
    const plane = signed([
      { scope: "electorate", electionId: "2025", electorate: "bean", ...AUDIT },
    ]);
    expect(isAllowed(plane, { kind: "printing", electionId: "2025", electorate: "bean" })).toBe(
      false,
    );
    expect(
      isAllowed(plane, { kind: "printing", electionId: "2025", electorate: "wentworth" }),
    ).toBe(true);
  });
  it("map suspension refuses that map only", () => {
    const plane = signed([{ scope: "map", mapId: "2025/NSW", ...AUDIT }]);
    expect(isAllowed(plane, { kind: "map", mapId: "2025/NSW" })).toBe(false);
    expect(isAllowed(plane, { kind: "map", mapId: "2025/VIC" })).toBe(true);
  });
});

describe("fail closed: a tampered or unsigned plane refuses everything", () => {
  const caps: Capability[] = [
    { kind: "research" },
    { kind: "publication" },
    { kind: "printing", electionId: "2025" },
    { kind: "decoding", electionId: "2025" },
    { kind: "election", electionId: "2025" },
    { kind: "map", mapId: "2025/NSW" },
  ];

  it("a body edited after signing (deleted suspension) is rejected — no capability comes back", () => {
    // Attacker deletes a suspension from a signed plane without re-signing.
    const original = signed([{ scope: "printing", ...AUDIT }]);
    const tampered = { ...original, suspensions: [] as Suspension[] };
    expect(isTampered(tampered)).toBe(true);
    for (const c of caps) expect(isAllowed(tampered, c)).toBe(false);
    // The mapping / proposition / banner helpers also fail closed to empty / false.
    expect(mappingSuspendedPartyKeys(tampered, "2025").size).toBe(0);
    expect(hasCorrectionNotice(tampered, "2025")).toBe(false);
  });

  it("a missing integrity field is rejected", () => {
    const unsigned = { schemaVersion: 1, suspensions: [] } as unknown;
    expect(isTampered(unsigned)).toBe(true);
    for (const c of caps) expect(isAllowed(unsigned, c)).toBe(false);
  });

  it("a wrong-typed / malformed plane is rejected", () => {
    for (const bad of [null, undefined, 42, "x", [], { schemaVersion: 2, suspensions: [] }]) {
      expect(isTampered(bad)).toBe(true);
      expect(isAllowed(bad, { kind: "election", electionId: "2025" })).toBe(false);
    }
  });
});
