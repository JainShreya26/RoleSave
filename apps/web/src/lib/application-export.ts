import ExcelJS from "exceljs";

export interface ApplicationExportRow {
  applied_at: string | null;
  company: string;
  position: string;
  status: string;
}

function readableStatus(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export function validTimeZone(value: unknown) {
  if (typeof value !== "string" || value.length > 100) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value;
  } catch {
    return "UTC";
  }
}

function calendarDate(value: string | null, timeZone: string) {
  if (!value) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "numeric",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date(value));
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return new Date(Date.UTC(read("year"), read("month") - 1, read("day")));
}

export function exportDateKey(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${read("year")}-${read("month")}-${read("day")}`;
}

export async function createApplicationWorkbook(rows: ApplicationExportRow[], timeZone: string) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "RoleSave";
  workbook.created = new Date();
  workbook.modified = new Date();

  const sheet = workbook.addWorksheet("Applications", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = [
    { header: "Company name", key: "company", width: 30 },
    { header: "Title", key: "position", width: 42 },
    { header: "Date applied", key: "appliedAt", width: 16 },
    { header: "Status", key: "status", width: 18 },
  ];
  sheet.autoFilter = "A1:D1";
  sheet.getRow(1).height = 24;
  sheet.getRow(1).eachCell((cell) => {
    cell.alignment = { vertical: "middle" };
    cell.fill = { fgColor: { argb: "FF17243D" }, pattern: "solid", type: "pattern" };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
  });

  rows.forEach((application, index) => {
    const row = sheet.addRow({
      appliedAt: calendarDate(application.applied_at, timeZone),
      company: application.company,
      position: application.position,
      status: readableStatus(application.status),
    });
    row.getCell("appliedAt").numFmt = "mm/dd/yyyy";
    row.alignment = { vertical: "top", wrapText: true };
    if (index % 2 === 1) {
      row.eachCell((cell) => {
        cell.fill = { fgColor: { argb: "FFF6F7F9" }, pattern: "solid", type: "pattern" };
      });
    }
  });

  return workbook.xlsx.writeBuffer();
}
