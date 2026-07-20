#!/usr/bin/env node
/**
 * Build-time security.txt generator (RFC 9116).
 *
 * Writes static/.well-known/security.txt with an `Expires` one year out, so the file is always
 * within its validity window without manual upkeep. Contact is the repository's private security
 * advisory form (no email address to keep in sync). The output is gitignored — regenerated on
 * every build, never hand-edited.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = join(ROOT, "static", ".well-known", "security.txt");

const SITE = "https://how2vote.au";
const ADVISORIES = "https://github.com/National-Digital/how2vote.au/security/advisories/new";

const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

const body = `# how2vote security policy (RFC 9116). Report vulnerabilities via the contact below.
Contact: ${ADVISORIES}
Expires: ${expires}
Preferred-Languages: en
Canonical: ${SITE}/.well-known/security.txt
`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, body, "utf8");
console.info(`✓ Generated security.txt → ${OUT} (expires ${expires})`);
