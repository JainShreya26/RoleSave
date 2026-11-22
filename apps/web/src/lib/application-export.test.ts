import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { createApplicationWorkbook, exportDateKey, validTimeZone } from "./application-export.ts";

test("creates a formatted workbook with the requested application columns", async () => {
  const output = await createApplicationWorkbook([
    {
      applied_at: "2026-11-05T00:30:00.000Z",
      company: "Acme",
      position: "Data Scientist",
      status: "NEEDS_REVIEW",
    },
  ], "America/Detroit");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(output);
  const sheet = workbook.getWorksheet("Applications");

  assert.ok(sheet);
  assert.deepEqual((sheet.getRow(1).values as unknown[]).slice(1), ["Company name", "Title", "Date applied", "Status"]);
  assert.equal(sheet.getCell("A2").value, "Acme");
  assert.equal(sheet.getCell("B2").value, "Data Scientist");
  assert.equal((sheet.getCell("C2").value as Date).toISOString(), "2026-11-04T00:00:00.000Z");
  assert.equal(sheet.getCell("C2").numFmt, "mm/dd/yyyy");
  assert.equal(sheet.getCell("D2").value, "Needs Review");
  assert.equal(sheet.views[0]?.state, "frozen");
  assert.equal(sheet.autoFilter?.toString(), "A1:D1");
});

test("uses safe time zones and local dates in filenames", () => {
  assert.equal(validTimeZone("America/Detroit"), "America/Detroit");
  assert.equal(validTimeZone("not/a-zone"), "UTC");
  assert.equal(exportDateKey("America/Detroit", new Date("2026-11-06T01:00:00.000Z")), "2026-11-05");
});
