import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  MODIFICATIONS,
  NOTICE,
  compile,
  meshBlockPersons,
  parseCsv,
  readXlsx,
  readXlsxSheets,
} from "./build-postcode-electorates.mjs";

const pc = (POSTCODE, CED_CODE_2024, CED_NAME_2024, BMOS_NULL_FLAG = "0") => ({
  POSTCODE,
  CED_CODE_2024,
  CED_NAME_2024,
  BMOS_NULL_FLAG,
});
const same = (code, name) => ({
  CED_CODE_2024: code,
  CED_NAME_2024: name,
  CED_CODE_2025: code,
  CED_NAME_2025: name,
  RATIO_FROM_TO: "1",
});
const mb = (MB_CODE_2021, code, name, year) => ({
  MB_CODE_2021,
  [`CED_CODE_${year}`]: code,
  [`CED_NAME_${year}`]: name,
});

const base = {
  cedChange: [
    same("237", "Melbourne"),
    same("702", "Solomon"),
    same("103", "Bennelong"),
    same("142", "Warringah"),
    { ...same("701", "Lingiari"), RATIO_FROM_TO: "0.93" },
    {
      ...same("701", "Lingiari"),
      CED_CODE_2025: "702",
      CED_NAME_2025: "Solomon",
      RATIO_FROM_TO: "0.07",
    },
  ],
  ced2024: [mb("1", "701", "Lingiari", 2024), mb("2", "702", "Solomon", 2024)],
  ced2025: [mb("1", "702", "Solomon", 2025), mb("2", "702", "Solomon", 2025)],
  poa: [
    { MB_CODE_2021: "1", POA_CODE_2021: "0832" },
    { MB_CODE_2021: "2", POA_CODE_2021: "0832" },
  ],
  persons: new Map([
    ["1", 40],
    ["2", 60],
  ]),
};

/** A postal area whose moved mesh block went to Solomon, with the rest still in Lingiari. */
const nt = (persons) => ({
  ...base,
  ced2024: [
    mb("1", "701", "Lingiari", 2024),
    mb("2", "702", "Solomon", 2024),
    mb("3", "701", "Lingiari", 2024),
  ],
  ced2025: [
    mb("1", "702", "Solomon", 2025),
    mb("2", "702", "Solomon", 2025),
    mb("3", "701", "Lingiari", 2025),
  ],
  poa: ["1", "2", "3"].map((m) => ({ MB_CODE_2021: m, POA_CODE_2021: "0830" })),
  persons: new Map(Object.entries(persons)),
  postcodeCed: [pc("830", "702", "Solomon"), pc("830", "701", "Lingiari")],
});

describe("compile", () => {
  it("keeps a single-electorate postcode, padding the code to four digits", () => {
    const { postcodes } = compile({ ...base, postcodeCed: [pc("800", "702", "Solomon")] });
    expect(postcodes).toEqual([{ postcode: "0800", in: ["Solomon"] }]);
  });

  it("lists a below-minimum share apart, and skips rows with no division", () => {
    const { postcodes } = compile({
      ...base,
      postcodeCed: [
        pc("2066", "142", "Warringah"),
        pc("2066", "103", "Bennelong"),
        pc("2000", "142", "Warringah"),
        pc("2000", "103", "Bennelong", "1"),
        pc("2000", null, null, "4"),
        pc("NA", "237", "Melbourne"),
      ],
    });
    expect(postcodes).toEqual([
      { postcode: "2000", in: ["Warringah"], partly: ["Bennelong"] },
      { postcode: "2066", in: ["Bennelong", "Warringah"] },
    ]);
  });

  it("takes a postcode holding a moved mesh block from the CED 2025 allocation", () => {
    const { postcodes, recomputed } = compile({
      ...base,
      postcodeCed: [pc("832", "702", "Solomon"), pc("832", "701", "Lingiari")],
    });
    expect(recomputed).toEqual(["0832"]);
    expect(postcodes).toEqual([{ postcode: "0832", in: ["Solomon"] }]);
  });

  it("orders postcodes as four-digit strings, the 08xx codes first", () => {
    const { postcodes } = compile({
      ...base,
      postcodeCed: [pc("9999", "237", "Melbourne"), pc("800", "702", "Solomon")],
    });
    expect(postcodes.map((p) => p.postcode)).toEqual(["0800", "9999"]);
  });

  it("leaves out a division whose remaining mesh blocks in the postal area are unpopulated", () => {
    const { postcodes } = compile(nt({ 1: 500, 2: 9500, 3: 0 }));
    expect(postcodes).toEqual([{ postcode: "0830", in: ["Solomon"] }]);
  });

  it("weights a recomputed postal area by persons, with the minimum output size rule", () => {
    expect(compile(nt({ 1: 0, 2: 9950, 3: 50 })).postcodes).toEqual([
      { postcode: "0830", in: ["Solomon"], partly: ["Lingiari"] },
    ]);
    expect(compile(nt({ 1: 0, 2: 9000, 3: 1000 })).postcodes).toEqual([
      { postcode: "0830", in: ["Lingiari", "Solomon"] },
    ]);
  });

  it("falls back to membership when a recomputed postal area has no population", () => {
    expect(compile(nt({})).postcodes).toEqual([{ postcode: "0830", in: ["Lingiari", "Solomon"] }]);
  });

  it("refuses a division with no CED 2025 successor", () => {
    const cedChange = [{ ...same("999", "Gone"), CED_CODE_2025: "998", RATIO_FROM_TO: "1" }];
    expect(() => compile({ ...base, cedChange, postcodeCed: [pc("3000", "999", "Gone")] })).toThrow(
      "no CED 2025 successor",
    );
  });
});

/** A workbook of the given sheets, the shared strings compressed and the sheets stored. */
function workbook(sheet, strings, ...more) {
  const parts = [
    ["xl/sharedStrings.xml", strings, true],
    ["xl/worksheets/sheet1.xml", sheet, false],
    ...more.map((xml, i) => [`xl/worksheets/sheet${i + 2}.xml`, xml, false]),
  ];
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, text, deflate] of parts) {
    const raw = Buffer.from(text);
    const data = deflate ? deflateRawSync(raw) : raw;
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt16LE(n.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(deflate ? 8 : 0, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt16LE(n.length, 28);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    central.push(entry, n);
    offset += 30 + n.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

describe("readXlsx", () => {
  it("reads shared strings, numbers, inline strings and gaps", () => {
    const strings =
      "<sst><si><t>POSTCODE</t></si><si><t>NAME</t></si><si><t>O&apos;Connor</t></si></sst>";
    const sheet =
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2"><v>6000</v></c><c r="B2" t="s"><v>2</v></c></row>' +
      '<row r="3"><c r="B3" t="inlineStr"><is><t>Grey</t></is></c></row></sheetData></worksheet>';
    expect(readXlsx(workbook(sheet, strings))).toEqual([
      ["POSTCODE", "NAME"],
      ["6000", "O'Connor"],
      [null, "Grey"],
    ]);
  });
});

describe("parseCsv", () => {
  it("reads a header row and strips a byte-order mark", () => {
    expect(parseCsv("\uFEFFA,B\r\n1,2\n")).toEqual([{ A: "1", B: "2" }]);
  });
});

describe("meshBlockPersons", () => {
  it("reads persons from every sheet after its header row", () => {
    const sheet = (rows) =>
      `<worksheet><sheetData>${rows
        .map(
          (cells, r) =>
            `<row r="${r + 1}">${cells
              .map((v, c) => `<c r="${"ABCDEF"[c]}${r + 1}" t="inlineStr"><is><t>${v}</t></is></c>`)
              .join("")}</row>`,
        )
        .join("")}</sheetData></worksheet>`;
    const header = [
      "MB_CODE_2021",
      "MB_CATEGORY_NAME_2021",
      "AREA_ALBERS_SQKM",
      "Dwelling",
      "Person",
    ];
    const book = workbook(
      sheet([["Contents"], ["Table 1"]]),
      "<sst></sst>",
      sheet([["Table 7"], header, ["70000011000", "Industrial", "0.28", "14", "38"]]),
      sheet([header, ["80000010000", "Parkland", "0.67", "0", "0"], ["note", "", "", "", ""]]),
    );
    expect(readXlsxSheets(book)).toHaveLength(3);
    expect([...meshBlockPersons(readXlsxSheets(book))]).toEqual([
      ["70000011000", 38],
      ["80000010000", 0],
    ]);
  });
});

describe("the committed compiled file", () => {
  const compiled = JSON.parse(
    readFileSync(new URL("../data/postcodes/postcode-electorates.json", import.meta.url), "utf8"),
  );
  it("carries its CC BY 4.0 notice", () => {
    expect(compiled.attribution).toMatch(/Australian Bureau of Statistics/);
    expect(compiled.licence).toEqual({
      id: "CC-BY-4.0",
      url: "https://creativecommons.org/licenses/by/4.0/",
    });
    expect(compiled.source.map((s) => s.title)).toContain(
      "ASGS Geographic Correspondences (2021) Edition 3",
    );
    expect(compiled.modifications).toBe(MODIFICATIONS);
    expect(compiled.notice).toBe(NOTICE);
  });
  it("lists postcodes in four-digit order", () => {
    const codes = compiled.postcodes.map((p) => p.postcode);
    expect(codes[0]).toBe("0800");
    expect(codes).toEqual([...codes].sort());
  });
});
