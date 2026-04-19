'use strict';

const ExcelJS = require('exceljs');
const {
  DETAIL_SHEET_NAME,
  MASTER_SHEET_NAME,
  DETAIL_COLUMNS,
  MASTER_COLUMNS,
  OWNER_COLUMNS,
  REPORT_THEME,
  sanitizeSheetName,
} = require('./report-schema');

function borderAll(style = REPORT_THEME.thinBorder, color = REPORT_THEME.borderColor) {
  return {
    top: { style, color: { argb: color } },
    left: { style, color: { argb: color } },
    bottom: { style, color: { argb: color } },
    right: { style, color: { argb: color } },
  };
}

function setColumnWidths(worksheet, columns) {
  columns.forEach((column, index) => {
    worksheet.getColumn(index + 1).width = column.width;
  });
}

function styleHeaderRow(row, { fill, fontColor = '000000', border = false, height = 30, center = true }) {
  row.height = height;
  row.eachCell((cell) => {
    cell.font = { name: REPORT_THEME.fontName, bold: true, color: { argb: fontColor } };
    if (fill) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    }
    cell.alignment = { horizontal: center ? 'center' : 'left', vertical: 'middle', wrapText: true };
    if (border) cell.border = borderAll();
  });
}

function applyNumericFormat(row, numericIndexes) {
  numericIndexes.forEach((index) => {
    row.getCell(index).numFmt = '0.00';
  });
}

function addDetailSheet(workbook, detailRows) {
  const ws = workbook.addWorksheet(DETAIL_SHEET_NAME, {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.75, right: 0.75, top: 1, bottom: 1 } },
  });
  setColumnWidths(ws, DETAIL_COLUMNS);
  ws.addRow(DETAIL_COLUMNS.map((col) => col.header));
  styleHeaderRow(ws.getRow(1), { fill: REPORT_THEME.detailHeaderFill, height: 20, center: false });

  for (const row of detailRows) {
    ws.addRow(DETAIL_COLUMNS.map((column) => row[column.key] ?? ''));
  }
  return ws;
}

function addMasterSheet(workbook, summaryRows) {
  const ws = workbook.addWorksheet(MASTER_SHEET_NAME, {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1', margins: { left: 0.75, right: 0.75, top: 1, bottom: 1 } },
  });
  setColumnWidths(ws, MASTER_COLUMNS);
  ws.addRow(MASTER_COLUMNS.map((col) => col.header));
  styleHeaderRow(ws.getRow(1), { fill: REPORT_THEME.masterHeaderFill, border: true, height: 58.5, center: false });

  for (const item of summaryRows) {
    const row = ws.addRow([
      item.month,
      item.client_name,
      item.bcba_name,
      item.scheduled_97153_hours,
      { formula: `D${ws.rowCount + 1}*0.1`, result: item.total_97155_needed },
      item.total_97155_completed,
      item.total_97155_still_needed,
      { formula: `E${ws.rowCount + 1}*0.25`, result: item.in_person_97155_required },
      item.in_person_97155_completed,
      item.in_person_97155_still_needed,
      item.telehealth_97155_completed,
      item.status_97155,
      item.telehealth_97155_still_needed,
      item.status_in_person,
      item.status_overall,
      item.note || '',
    ]);

    row.eachCell((cell) => {
      cell.font = { name: REPORT_THEME.fontName, size: 10 };
      cell.border = borderAll();
      cell.alignment = { vertical: 'middle', wrapText: false };
    });
    applyNumericFormat(row, [4, 5, 6, 7, 8, 9, 10, 13]);

    const inPersonStatus = row.getCell(14);
    const overallStatus = row.getCell(15);
    if (String(inPersonStatus.value).toUpperCase() === 'PASS') {
      inPersonStatus.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: REPORT_THEME.passFill } };
    } else {
      inPersonStatus.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: REPORT_THEME.warnFill } };
    }
    if (String(overallStatus.value).toUpperCase() === 'PASS') {
      overallStatus.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: REPORT_THEME.passFill } };
    } else {
      overallStatus.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: REPORT_THEME.warnFill } };
    }
  }
  return ws;
}

function addOwnerSheet(workbook, ownerReport, usedSheetNames) {
  const ws = workbook.addWorksheet(sanitizeSheetName(ownerReport.owner_name, usedSheetNames), {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1', margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75 } },
  });
  setColumnWidths(ws, OWNER_COLUMNS);
  ws.addRow(OWNER_COLUMNS.map((col) => col.header));
  styleHeaderRow(ws.getRow(1), { fill: REPORT_THEME.childHeaderFill, fontColor: REPORT_THEME.childHeaderFont, height: 30, center: true });

  ownerReport.rows.forEach((item, index) => {
    const row = ws.addRow(OWNER_COLUMNS.map((column) => item[column.key] ?? ''));
    const isAlt = index % 2 === 1;
    row.eachCell((cell) => {
      cell.font = { name: REPORT_THEME.fontName, size: 10 };
      cell.alignment = { vertical: 'middle', wrapText: false };
      if (isAlt) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: REPORT_THEME.alternatingFill } };
      }
    });
    applyNumericFormat(row, [2, 3, 4, 5, 6, 7, 8, 9, 11]);
  });
  return ws;
}

async function build97155Workbook({ detailRows, summaryRows, ownerReports }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'All Star ABA';
  workbook.created = new Date();
  workbook.modified = new Date();

  addDetailSheet(workbook, detailRows);
  addMasterSheet(workbook, summaryRows);

  const usedSheetNames = new Set([DETAIL_SHEET_NAME, MASTER_SHEET_NAME]);
  ownerReports.forEach((ownerReport) => addOwnerSheet(workbook, ownerReport, usedSheetNames));
  return workbook;
}

module.exports = {
  build97155Workbook,
};
