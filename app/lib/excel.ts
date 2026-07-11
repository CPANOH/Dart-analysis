import ExcelJS from "exceljs";
import { CompanyResult, METRIC_ROWS, RATIO_ROWS } from "./dart";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF4472C4" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" } };

export async function buildWorkbook(results: CompanyResult[]): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();

  const usable = results.filter((r) => !r.notFound && Object.keys(r.byYear).length);

  // 1) 요약비교 시트
  const summarySheet = workbook.addWorksheet("요약비교");
  const columns: { company: string; year: number }[] = [];
  for (const r of usable) {
    for (const year of Object.keys(r.byYear).map(Number).sort((a, b) => b - a)) {
      columns.push({ company: r.resolvedName, year });
    }
  }

  summarySheet.getColumn(1).width = 16;
  summarySheet.getColumn(2).width = 16;

  const companyHeaderRow = summarySheet.getRow(1);
  const yearHeaderRow = summarySheet.getRow(2);
  companyHeaderRow.getCell(1).value = "회사";
  yearHeaderRow.getCell(1).value = "지표";
  columns.forEach((col, idx) => {
    const c = idx + 2;
    companyHeaderRow.getCell(c).value = col.company;
    yearHeaderRow.getCell(c).value = col.year;
    summarySheet.getColumn(c).width = 16;
  });

  const allRows = [...METRIC_ROWS, ...RATIO_ROWS];
  allRows.forEach((label, rIdx) => {
    const row = summarySheet.getRow(3 + rIdx);
    row.getCell(1).value = label;
    columns.forEach((col, cIdx) => {
      const yearData = usable.find((r) => r.resolvedName === col.company)?.byYear[col.year];
      const value = METRIC_ROWS.includes(label)
        ? yearData?.metrics[label] ?? null
        : yearData?.ratios[label] ?? null;
      const cell = row.getCell(cIdx + 2);
      cell.value = value;
      if (value != null) cell.numFmt = "#,##0.##";
    });
  });

  for (const row of [companyHeaderRow, yearHeaderRow]) {
    row.eachCell((cell) => {
      cell.font = HEADER_FONT;
      cell.fill = HEADER_FILL;
      cell.alignment = { horizontal: "center" };
    });
  }
  summarySheet.views = [{ state: "frozen", xSplit: 1, ySplit: 2 }];

  // 2) 회사별 상세 시트
  for (const r of usable) {
    const sheetName = r.resolvedName.slice(0, 31);
    const sheet = workbook.addWorksheet(sheetName);

    const headers = ["연도", "재무제표구분", ...METRIC_ROWS, ...RATIO_ROWS];
    const headerRow = sheet.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.font = HEADER_FONT;
      cell.fill = HEADER_FILL;
      cell.alignment = { horizontal: "center" };
    });

    const years = Object.keys(r.byYear).map(Number).sort((a, b) => b - a);
    for (const year of years) {
      const d = r.byYear[year];
      const row = [
        year,
        d.fsDiv,
        ...METRIC_ROWS.map((m) => d.metrics[m]),
        ...RATIO_ROWS.map((rr) => d.ratios[rr]),
      ];
      sheet.addRow(row);
    }

    sheet.columns.forEach((col) => {
      col.width = 16;
    });
    sheet.views = [{ state: "frozen", ySplit: 1 }];
  }

  return workbook.xlsx.writeBuffer();
}
