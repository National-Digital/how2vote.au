#!/usr/bin/env node
/**
 * @fileoverview Compiles data/postcodes/postcode-electorates.json from the ABS sources pinned in
 * data/postcodes/source-record.json.
 *
 * Membership comes from the ABS correspondence CG_POSTCODE_2024_CED_2024. CED 2024 and CED 2025
 * differ only where the 2025 Northern Territory redistribution moved mesh blocks from Lingiari to
 * Solomon; postcodes containing a moved mesh block take their CED 2025 membership from the ABS
 * allocation files (MB 2021 to CED 2025, MB 2021 to POA 2021), weighted by Census 2021 persons per
 * mesh block. No boundary geometry is read.
 *
 * The source files are not committed. Download them (URLs in the source record) into one folder:
 *   node scripts/build-postcode-electorates.mjs <dir>           # write the compiled file
 *   node scripts/build-postcode-electorates.mjs <dir> --check   # verify pins and the committed file
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

/** Below-minimum-output-size flag: the ABS treats the share as statistically insignificant. */
const BMOS_MINOR = 1;
/** The ABS minimum output size, as a share of a postcode's population. */
const MINIMUM_SHARE = 0.01;

/** CC BY 4.0 §3(a)(1)(B) and (A)(iv) statements carried in the compiled file. */
export const MODIFICATIONS =
  "Adapted by How2Vote: postcodes matched to federal electorates by population share; NT postcodes 0830 and 0832 recomputed for the 2025 boundaries from ABS allocation files weighted by Census 2021 persons.";
export const NOTICE = "Provided without warranty; see the licence.";

/**
 * Entries of a zip archive, by name.
 * @param {Buffer} buf
 * @returns {Map<string, Buffer>}
 */
export function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip archive");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    out.set(name, method === 0 ? raw : inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescapeXml = (s) =>
  s.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, (_, e) =>
    e.startsWith("#") ? String.fromCharCode(Number(e.slice(1))) : XML_ENTITIES[e],
  );

/**
 * Rows of every worksheet of an .xlsx workbook, in sheet order, as arrays of cell strings (null
 * when empty).
 * @param {Buffer} buf
 * @returns {(string | null)[][][]}
 */
export function readXlsxSheets(buf) {
  const files = unzip(buf);
  const shared = [];
  const sst = files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  for (const si of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    shared.push(
      unescapeXml([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")),
    );
  }
  const sheetNumber = (name) => Number(/sheet(\d+)\.xml$/.exec(name)?.[1]);
  const names = [...files.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => sheetNumber(a) - sheetNumber(b));
  if (names.length === 0) throw new Error("workbook has no worksheet");
  const col = (ref) =>
    [...ref.replace(/\d+$/, "")].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  return names.map((name) => {
    const sheet = /** @type {Buffer} */ (files.get(name)).toString("utf8");
    const rows = [];
    for (const row of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const c of row[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /r="([A-Z]+\d+)"/.exec(c[1])?.[1];
        const type = /t="(\w+)"/.exec(c[1])?.[1];
        const body = c[2] ?? "";
        let value = null;
        if (type === "inlineStr")
          value = unescapeXml(/<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1] ?? "");
        else {
          const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
          if (v !== undefined) value = type === "s" ? shared[Number(v)] : unescapeXml(v);
        }
        cells[ref ? col(ref) : cells.length] = value;
      }
      rows.push(Array.from(cells, (v) => v ?? null));
    }
    return rows;
  });
}

/**
 * Rows of the first worksheet of an .xlsx workbook.
 * @param {Buffer} buf
 */
export const readXlsx = (buf) => /** @type {(string | null)[][]} */ (readXlsxSheets(buf)[0]);

/**
 * Persons per Mesh Block from the Census Mesh Block Counts workbook: every sheet whose header row
 * names MB_CODE_2021 and Person.
 * @param {(string | null)[][][]} sheets
 * @returns {Map<string, number>}
 */
export function meshBlockPersons(sheets) {
  const persons = new Map();
  for (const rows of sheets) {
    let mb = -1;
    let person = -1;
    for (const r of rows) {
      if (mb < 0) {
        mb = r.indexOf("MB_CODE_2021");
        person = mb < 0 ? -1 : r.indexOf("Person");
        if (person < 0) mb = -1;
        continue;
      }
      const code = r[mb];
      if (code && /^\d{11}$/.test(code)) persons.set(code, Number(r[person] ?? 0) || 0);
    }
  }
  return persons;
}

/** @param {(string|null)[][]} rows @returns {Record<string, string|null>[]} */
const records = ([header, ...rows]) =>
  rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? null])));

/** @param {string} text @returns {Record<string, string>[]} */
export function parseCsv(text) {
  const [header, ...lines] = text
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/);
  const cols = header.split(",");
  return lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i], v])));
}

/**
 * Postcode membership in CED 2025.
 * @param {{
 *   postcodeCed: Record<string, string|null>[],
 *   cedChange: Record<string, string>[],
 *   ced2024: Record<string, string|null>[],
 *   ced2025: Record<string, string|null>[],
 *   poa: Record<string, string|null>[],
 *   persons: Map<string, number>,
 * }} src
 * @returns {{ postcodes: { postcode: string, in: string[], partly?: string[] }[], recomputed: string[] }}
 */
export function compile(src) {
  const unchanged = new Set();
  const byFrom = new Map();
  for (const r of src.cedChange) {
    byFrom.set(r.CED_CODE_2024, [...(byFrom.get(r.CED_CODE_2024) ?? []), r]);
  }
  for (const [code, rows] of byFrom) {
    if (
      rows.length === 1 &&
      rows[0].CED_CODE_2025 === code &&
      Number(rows[0].RATIO_FROM_TO) === 1
    ) {
      unchanged.add(code);
    }
  }

  const ced2024ByMb = new Map(src.ced2024.map((r) => [r.MB_CODE_2021, r.CED_CODE_2024]));
  const poaByMb = new Map(src.poa.map((r) => [r.MB_CODE_2021, r.POA_CODE_2021]));
  const movedTo = new Map();
  for (const r of src.ced2025) {
    const p = poaByMb.get(r.MB_CODE_2021);
    if (!p) continue;
    movedTo.set(p, [...(movedTo.get(p) ?? []), r]);
  }
  const recomputed = new Set();
  for (const r of src.ced2025) {
    if (ced2024ByMb.get(r.MB_CODE_2021) !== r.CED_CODE_2025) {
      const p = poaByMb.get(r.MB_CODE_2021);
      if (p) recomputed.add(p);
    }
  }

  /** @type {Map<string, { in: Set<string>, partly: Set<string> }>} */
  const acc = new Map();
  for (const r of src.postcodeCed) {
    if (!r.POSTCODE || !r.CED_CODE_2024 || !/^\d{1,4}$/.test(r.POSTCODE)) continue;
    const postcode = r.POSTCODE.padStart(4, "0");
    if (!unchanged.has(r.CED_CODE_2024)) {
      const kept = (byFrom.get(r.CED_CODE_2024) ?? []).some(
        (c) => c.CED_CODE_2025 === r.CED_CODE_2024,
      );
      if (!kept) throw new Error(`CED ${r.CED_CODE_2024} has no CED 2025 successor`);
    }
    const entry = acc.get(postcode) ?? { in: new Set(), partly: new Set() };
    const minor = Number(r.BMOS_NULL_FLAG) === BMOS_MINOR;
    (minor ? entry.partly : entry.in).add(/** @type {string} */ (r.CED_NAME_2024));
    acc.set(postcode, entry);
  }
  const replaced = [...recomputed].filter((postcode) => acc.has(postcode)).sort();
  for (const postcode of replaced) {
    const persons = new Map();
    let total = 0;
    for (const r of movedTo.get(postcode) ?? []) {
      const n = src.persons.get(/** @type {string} */ (r.MB_CODE_2021)) ?? 0;
      const name = /** @type {string} */ (r.CED_NAME_2025);
      persons.set(name, (persons.get(name) ?? 0) + n);
      total += n;
    }
    const entry = { in: new Set(), partly: new Set() };
    for (const [name, n] of persons) {
      if (total === 0 || n / total >= MINIMUM_SHARE) entry.in.add(name);
      else if (n > 0) entry.partly.add(name);
    }
    acc.set(postcode, entry);
  }

  const postcodes = [];
  for (const postcode of [...acc.keys()].sort()) {
    const { in: main, partly } = acc.get(postcode);
    for (const n of main) partly.delete(n);
    if (main.size === 0) {
      for (const n of partly) main.add(n);
      partly.clear();
    }
    const entry = { postcode, in: [...main].sort() };
    if (partly.size > 0) entry.partly = [...partly].sort();
    postcodes.push(entry);
  }
  return { postcodes, recomputed: replaced };
}

/* c8 ignore start -- CLI/fs plumbing */
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function main() {
  const [dir, flag] = process.argv.slice(2);
  const root = new URL("..", import.meta.url);
  const recordPath = new URL("data/postcodes/source-record.json", root);
  const outPath = new URL("data/postcodes/postcode-electorates.json", root);
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  if (!dir) {
    console.error("usage: build-postcode-electorates.mjs <source-dir> [--check]");
    process.exit(2);
  }
  const files = {};
  for (const s of record.sources) {
    const path = join(dir, s.fileName);
    if (!existsSync(path)) {
      console.error(`missing ${s.fileName} (download from ${s.url})`);
      process.exit(1);
    }
    files[s.id] = readFileSync(path);
    if (sha256(files[s.id]) !== s.sha256) {
      console.error(`${s.fileName}: SHA-256 does not match the pinned value`);
      process.exit(1);
    }
  }
  const { postcodes, recomputed } = compile({
    postcodeCed: records(readXlsx(files["postcode-ced-2024"])),
    cedChange: parseCsv(files["ced-2024-ced-2025"].toString("utf8")),
    ced2024: records(readXlsx(files["mb-ced-2024"])),
    ced2025: records(readXlsx(files["mb-ced-2025"])),
    poa: records(readXlsx(files["mb-poa-2021"])),
    persons: meshBlockPersons(readXlsxSheets(files["mb-persons-2021"])),
  });
  const register = JSON.parse(
    readFileSync(new URL("data/rights/rights-classes.json", root), "utf8"),
  );
  const rc = register.rightsClasses.find((c) => c.id === record.rightsClass);
  const compiled = {
    schemaVersion: 2,
    rightsClass: record.rightsClass,
    attribution: rc.attribution,
    licence: { id: rc.licence.spdxId, url: rc.licence.url },
    source: record.citations,
    modifications: MODIFICATIONS,
    notice: NOTICE,
    cedEdition: record.cedEdition,
    recomputedFromAllocations: recomputed,
    postcodes,
  };
  const text = `${JSON.stringify(compiled, null, 1)}\n`;
  if (flag === "--check") {
    const committed = readFileSync(outPath, "utf8");
    if (committed !== text) {
      console.error("data/postcodes/postcode-electorates.json does not match the pinned sources");
      process.exit(1);
    }
    console.info(`postcode-electorates OK — ${postcodes.length} postcodes`);
    return;
  }
  writeFileSync(outPath, text);
  console.info(`wrote ${postcodes.length} postcodes (${sha256(Buffer.from(text))})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
/* c8 ignore stop */
