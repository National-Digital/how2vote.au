import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./paths.js";
import { controlPlaneDigest, evaluatePublicationSuspension } from "./control-plane.js";

const AUDIT = { reason: "rehearsal", by: "ops", flaggedAt: "2026-07-16" };

function signed(suspensions: Record<string, unknown>[]) {
  const body = { schemaVersion: 1, suspensions };
  return { schemaVersion: 1, suspensions, integrity: controlPlaneDigest(body) };
}

describe("evaluatePublicationSuspension (fail-closed publication gate)", () => {
  it("permits publishing on a signed plane with no publication suspension", () => {
    expect(evaluatePublicationSuspension(signed([])).suspended).toBe(false);
    // A non-publication suspension does not stop publishing.
    expect(evaluatePublicationSuspension(signed([{ scope: "printing", ...AUDIT }])).suspended).toBe(
      false,
    );
  });

  it("suspends publishing while a publication suspension is active (data-poisoning rehearsal)", () => {
    const v = evaluatePublicationSuspension(
      signed([{ scope: "publication", ...AUDIT, reason: "suspected poisoning" }]),
    );
    expect(v.suspended).toBe(true);
    expect(v.reason).toContain("suspected poisoning");
  });

  it("resumes publishing once the suspension is lifted (restore rehearsal)", () => {
    const v = evaluatePublicationSuspension(
      signed([{ scope: "publication", ...AUDIT, liftedAt: "2026-07-17", liftedBy: "ops" }]),
    );
    expect(v.suspended).toBe(false);
  });

  it("fails closed on an unreadable / unsigned / tampered plane", () => {
    expect(evaluatePublicationSuspension(null).suspended).toBe(true);
    expect(evaluatePublicationSuspension("nope").suspended).toBe(true);
    expect(evaluatePublicationSuspension({ schemaVersion: 1, suspensions: [] }).suspended).toBe(
      true,
    ); // unsigned
    const tampered = signed([]);
    tampered.suspensions = [{ scope: "publication", ...AUDIT }]; // body changed after signing
    expect(evaluatePublicationSuspension(tampered).suspended).toBe(true);
  });

  it("the committed control plane is signed and permits publishing (digest matches the runtime signer)", () => {
    const raw = JSON.parse(
      readFileSync(resolve(REPO_ROOT, "data/governance/control-plane.json"), "utf8"),
    );
    const v = evaluatePublicationSuspension(raw);
    expect(v.suspended).toBe(false);
  });
});
