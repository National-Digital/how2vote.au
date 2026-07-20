import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Loads `packages/data-pipeline/.env` into `process.env` for the bin entrypoints. tsx does NOT
 * auto-load env files, so before this existed the ".env" the error messages pointed at was never
 * actually read — keys only ever arrived via CI secrets. Deliberately tiny and dependency-free:
 * KEY=value lines, `#` comments, optional single/double quotes; already-set variables always win
 * (so CI secrets and inline `KEY=… pnpm …` overrides behave as expected); a missing file is fine.
 */
export function loadEnv(): void {
  const file = resolve(fileURLToPath(new URL("..", import.meta.url)), ".env");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return; // no .env — CI, or the operator exports variables directly
  }
  for (const line of text.split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || line.trimStart().startsWith("#")) continue;
    const [, name, rawValue] = match;
    const value = rawValue!.replace(/^(["'])(.*)\1$/, "$2");
    if (process.env[name!] === undefined) process.env[name!] = value;
  }
}
