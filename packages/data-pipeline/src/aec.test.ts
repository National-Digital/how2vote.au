import { describe, expect, it } from "vitest";
import {
  csvToRecords,
  electoratesFromHouse,
  parseCsv,
  parseHouseNominations,
  parseSenateNominations,
} from "./aec.js";

describe("parseCsv", () => {
  it("handles quoted fields, escaped quotes and CRLF", () => {
    const rows = parseCsv('a,b\r\n"x,y","he said ""hi"""\r\n');
    expect(rows).toEqual([
      ["a", "b"],
      ["x,y", 'he said "hi"'],
    ]);
  });
});

describe("csvToRecords", () => {
  it("skips an AEC preamble line before the header", () => {
    const text = "Generated 2025\nStateAb,DivisionNm\nACT,Bean\n";
    expect(csvToRecords(text)).toEqual([{ StateAb: "ACT", DivisionNm: "Bean" }]);
  });
});

describe("AEC nomination mapping", () => {
  const houseCsv =
    "StateAb,DivisionNm,PartyNm,Surname,GivenNm,BallotPosition\n" +
    "ACT,Bean,Australian Labor Party,SMITH,Jo,2\n" +
    "ACT,Bean,The Greens,DOE,Sam,1\n";

  it("maps House rows to ballot form", () => {
    const house = parseHouseNominations(houseCsv);
    expect(house).toEqual([
      {
        state: "ACT",
        division: "Bean",
        party: "Australian Labor Party",
        candidate: "SMITH, Jo",
        position: 2,
      },
      { state: "ACT", division: "Bean", party: "The Greens", candidate: "DOE, Sam", position: 1 },
    ]);
  });

  it("derives the electorate list without duplicates", () => {
    expect(electoratesFromHouse(parseHouseNominations(houseCsv))).toEqual([
      { state: "ACT", electorate: "Bean" },
    ]);
  });

  it("maps Senate rows with group/ticket", () => {
    const senateCsv =
      "StateAb,Ticket,PartyNm,Surname,GivenNm,BallotPosition\nACT,A,The Greens,DOE,Sam,1\n";
    expect(parseSenateNominations(senateCsv)).toEqual([
      { state: "ACT", group: "A", party: "The Greens", candidate: "DOE, Sam", position: 1 },
    ]);
  });
});
