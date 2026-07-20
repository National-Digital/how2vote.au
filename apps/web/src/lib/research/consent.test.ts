import { describe, expect, it } from "vitest";
import {
  ACCEPTED_CONSENT_VERSIONS,
  RESEARCH_CONSENT_VERSION,
  classifyConsentVersion,
  isAcceptedConsentVersion,
} from "./consent";

describe("classifyConsentVersion — server-enforced consent", () => {
  it("accepts the current version", () => {
    expect(classifyConsentVersion(RESEARCH_CONSENT_VERSION)).toBe("accepted");
    expect(ACCEPTED_CONSENT_VERSIONS[0]).toBe(RESEARCH_CONSENT_VERSION);
  });

  it("rejects a FUTURE (not-yet-published) version", () => {
    expect(classifyConsentVersion("2027-01")).toBe("future");
    expect(classifyConsentVersion("2026-08")).toBe("future");
    expect(classifyConsentVersion("2026-07.9")).toBe("future");
  });

  it("rejects a STALE (older) version", () => {
    expect(classifyConsentVersion("2026-07")).toBe("stale"); // .0 < .2
    expect(classifyConsentVersion("2025-01")).toBe("stale");
  });

  it("rejects a MALFORMED version", () => {
    expect(classifyConsentVersion("not a version!")).toBe("malformed");
    expect(classifyConsentVersion("2026")).toBe("malformed");
    expect(classifyConsentVersion(42)).toBe("malformed");
    expect(classifyConsentVersion(null)).toBe("malformed");
    expect(classifyConsentVersion(undefined)).toBe("malformed");
  });

  it("isAcceptedConsentVersion is true only for accepted versions", () => {
    expect(isAcceptedConsentVersion(RESEARCH_CONSENT_VERSION)).toBe(true);
    expect(isAcceptedConsentVersion("2027-01")).toBe(false);
    expect(isAcceptedConsentVersion("2026-07")).toBe(false);
    expect(isAcceptedConsentVersion("garbage")).toBe(false);
  });
});
