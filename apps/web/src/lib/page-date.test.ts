import { describe, expect, it } from "vitest";
import { manifestFor } from "./manifest";
import { dataPageModified } from "./page-date";

describe("dataPageModified", () => {
  it("dates party and issue pages by the data version", () => {
    expect(dataPageModified("2025", "parties")).toBe(manifestFor("2025").dataVersion);
    expect(dataPageModified("2025", "issues")).toBe("2025-03-28");
  });

  it("dates ballot pages no earlier than the declaration of nominations", () => {
    expect(dataPageModified("2025", "electorates")).toBe("2025-04-11");
    expect(dataPageModified("2025", "senate")).toBe("2025-04-11");
    // 2022's data version already follows its declaration.
    expect(dataPageModified("2022", "electorates")).toBe(manifestFor("2022").dataVersion);
  });

  it("dates a page no earlier than the other source it shows", () => {
    expect(dataPageModified("next", "postcodes", "2026-10-12")).toBe("2026-10-12");
    expect(dataPageModified("2025", "postcodes", "2001-01-01")).toBe("2025-03-28");
  });
});
