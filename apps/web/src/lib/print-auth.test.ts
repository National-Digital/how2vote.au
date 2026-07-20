import { describe, expect, it } from "vitest";
import { AUTHORISATION, ORG } from "./org";
import {
  formatAuthorisation,
  isPrintableText,
  MAX_PRINT_FIELD_LENGTH,
  PREFERENCE_SOURCE_NOTICE,
} from "./print-auth";

// National Digital authoriser model (docs/adr/0010): the printed how-to-vote plan carries National
// Digital's authorisation of the material it publishes, and the preference order is separately
// identified as the user's own selection. No user-entered particulars ever reach the printed stamp.

describe("formatAuthorisation — National Digital authoriser stamp", () => {
  it("stamps National Digital's entity authorisation, using the operator particulars", () => {
    const stamp = formatAuthorisation();
    expect(stamp).toContain(AUTHORISATION);
    expect(stamp).toContain("Authorised by");
    // The operator legal name + locality + State come from the single operator record.
    expect(stamp).toContain(ORG.legalName);
    expect(stamp).toContain(ORG.locality);
    expect(stamp).toContain(ORG.state);
  });

  it("separately identifies the preference order as the user's own selection", () => {
    expect(PREFERENCE_SOURCE_NOTICE).toBe("Preference order selected by the user.");
    expect(formatAuthorisation()).toContain(PREFERENCE_SOURCE_NOTICE);
  });

  it("carries NO user-entered particulars — no name field, no street address", () => {
    const stamp = formatAuthorisation();
    // A street-number + street-type pattern must never appear (the entity form is locality + State).
    expect(stamp).not.toMatch(/\b\d+\s+\w+\s+(street|st|road|rd|avenue|ave|lane|ln)\b/i);
    // It is a stable string derived from operator particulars, not per-user input.
    expect(formatAuthorisation()).toBe(formatAuthorisation());
  });
});

describe("isPrintableText — free-text print guard (control chars + length)", () => {
  it("accepts bounded, control-free text", () => {
    expect(isPrintableText("Ballarat")).toBe(true);
    expect(isPrintableText("x".repeat(MAX_PRINT_FIELD_LENGTH))).toBe(true);
  });

  it("rejects empty and over-length values", () => {
    expect(isPrintableText("")).toBe(false);
    expect(isPrintableText("x".repeat(MAX_PRINT_FIELD_LENGTH + 1))).toBe(false);
  });

  it("rejects control characters (NUL / newline / tab / DEL)", () => {
    expect(isPrintableText("bad\u0000char")).toBe(false);
    expect(isPrintableText("line\nbreak")).toBe(false);
    expect(isPrintableText("tab\tstop")).toBe(false);
    expect(isPrintableText("delchar")).toBe(false);
  });

  it("rejects non-string input", () => {
    // @ts-expect-error — defensive against a non-string reaching the printer
    expect(isPrintableText(null)).toBe(false);
    // @ts-expect-error — defensive against a non-string reaching the printer
    expect(isPrintableText(42)).toBe(false);
  });
});
