import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Guard: the research + geography ingestion endpoints emit ZERO telemetry.
 *
 * The in-flight research payload is the one place a profile momentarily exists; it must never be
 * copied into a log or error reporter (PIA; ADR-0008). This test pins that contract at the source
 * level — neither endpoint may contain a `console.*` call or import a logger — so no telemetry can
 * ever creep into the two files that must stay silent. Their `catch {}` blocks swallow deliberately.
 * (The site transmits no client-side errors at all — there is no error beacon or reporting endpoint.)
 */
const ZERO_LOG_ENDPOINTS = {
  research: "../research.ts",
  geography: "./geography.ts",
};

/** Match a real console.* CALL (console.log(...), console["error"](...)), not the word in a comment. */
const CONSOLE_CALL = /\bconsole\s*(\.\s*\w+|\[\s*["'`]\w+["'`]\s*\])\s*\(/;
/** Any import that looks like a logger/telemetry/reporter/sentry module. */
const LOGGER_IMPORT = /\bimport\b[^;]*\b(logger|logging|telemetry|sentry|reporter|analytics)\b/i;

describe("research + geography endpoints are zero-log (PIA / ADR-0008)", () => {
  for (const [name, rel] of Object.entries(ZERO_LOG_ENDPOINTS)) {
    const source = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

    it(`${name}: contains no console.* call`, () => {
      expect(CONSOLE_CALL.test(source), `${name} endpoint must not call console.*`).toBe(false);
    });

    it(`${name}: imports no logger / telemetry module`, () => {
      expect(LOGGER_IMPORT.test(source), `${name} endpoint must import no logger`).toBe(false);
    });
  }
});
