'use strict';

const ExcelJS = require('exceljs');
const { DETAIL_SHEET_NAME, MASTER_SHEET_NAME, normalizeHeader } = require('./report-schema');
const { asNumber, asText, derivePrimaryOwnerName } = require('./report-metrics');

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (value && typeof value === 'object') {
    if (value.text) return String(value.text).trim();
    if (value.result !== undefined) return cellText(value.result);
    if (value.richText) return value.richText.map((part) => part.text || '').join('').trim();
  }
  return String(value).trim();
}

function getRowValues(row) {
  return row.values.slice(1).map(cellText);
}

function findHeaderRow(worksheet, requiredHeaders) {
  const wanted = requiredHeaders.map(normalizeHeader);
  for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 10); rowNumber += 1) {
    const values = getRowValues(worksheet.getRow(rowNumber)).map(normalizeHeader);
    const matches = wanted.every((header) => values.includes(header));
    if (matches) return rowNumber;
  }
  return null;
}

function buildHeaderIndex(row) {
  const map = new Map();
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    map.set(normalizeHeader(cellText(cell.value)), colNumber);
  });
  return map;
}

function readCell(row, headerIndex, headerName) {
  const col = headerIndex.get(normalizeHeader(headerName));
  if (!col) return '';
  return cellText(row.getCell(col).value);
}

function parseDetailSheet(worksheet) {
  const headerRowNum = findHeaderRow(worksheet, ['Month', 'Date', 'Client', 'BCBA', 'Hours']);
  if (!headerRowNum) return [];
  const headerIndex = buildHeaderIndex(worksheet.getRow(headerRowNum));
  const rows = [];
  for (let rowNumber = headerRowNum + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const client_name = readCell(row, headerIndex, 'Client');
    const month = readCell(row, headerIndex, 'Month');
    if (!client_name && !month) continue;
    rows.push({
      month,
      service_date: readCell(row, headerIndex, 'Date'),
      client_name,
      bcba_name: readCell(row, headerIndex, 'BCBA'),
      hours: asNumber(readCell(row, headerIndex, 'Hours')),
      delivery_type: readCell(row, headerIndex, 'Delivery Type'),
      place_of_service: readCell(row, headerIndex, 'Place of Service'),
      modifier: readCell(row, headerIndex, 'Modifier'),
      note: readCell(row, headerIndex, 'Note'),
    });
  }
  return rows;
}

function parseSummarySheet(worksheet, ownerName = '') {
  const headerRowNum = findHeaderRow(worksheet, ['Client', '97153 Hrs Scheduled', 'Total 97155 Needed']);
  if (!headerRowNum) return [];
  const headerIndex = buildHeaderIndex(worksheet.getRow(headerRowNum));
  const rows = [];
  for (let rowNumber = headerRowNum + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const client_name = readCell(row, headerIndex, 'Client');
    if (!client_name) continue;
    rows.push({
      month: readCell(row, headerIndex, 'Month'),
      client_name,
      bcba_name: readCell(row, headerIndex, 'BCBA'),
      owner_name: ownerName || derivePrimaryOwnerName(readCell(row, headerIndex, 'BCBA')),
      scheduled_97153_hours: asNumber(readCell(row, headerIndex, '97153 Hrs Scheduled')),
      total_97155_needed: asNumber(readCell(row, headerIndex, 'Total 97155 Needed')),
      total_97155_completed: asNumber(readCell(row, headerIndex, 'Total 97155 Hrs Completed') || readCell(row, headerIndex, 'Total 97155 Hrs completed')),
      total_97155_still_needed: asNumber(readCell(row, headerIndex, '97155 Hrs Still Needed (Total)')),
      in_person_97155_required: asNumber(readCell(row, headerIndex, '97155 In-Person Required')),
      in_person_97155_completed: asNumber(readCell(row, headerIndex, '97155 In-Person Hrs COMPLETED') || readCell(row, headerIndex, '97155 In-Person Hrs completed')),
      in_person_97155_still_needed: asNumber(readCell(row, headerIndex, 'in-person hours still NEEDED') || readCell(row, headerIndex, 'in-person hours still needed')),
      telehealth_97155_completed: asNumber(readCell(row, headerIndex, '97155 Telehealth Hrs COMPLETED') || readCell(row, headerIndex, '97155 Telehealth (GT) Hrs completed')),
      status_97155: readCell(row, headerIndex, '97155 Status'),
      telehealth_97155_still_needed: asNumber(readCell(row, headerIndex, 'telehealth hours still needed')),
      status_in_person: readCell(row, headerIndex, '25% In-Person Status'),
      status_overall: readCell(row, headerIndex, 'Overall Status'),
      note: readCell(row, headerIndex, 'Note'),
    });
  }
  return rows;
}

async function parse97155Workbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheetNames = workbook.worksheets.map((sheet) => sheet.name);
  const detailSheet = workbook.getWorksheet(DETAIL_SHEET_NAME) || workbook.worksheets.find((sheet) => findHeaderRow(sheet, ['Month', 'Date', 'Client', 'BCBA', 'Hours']));
  const masterSheet = workbook.getWorksheet(MASTER_SHEET_NAME);

  const detailRows = detailSheet ? parseDetailSheet(detailSheet) : [];
  const ownerHints = new Map();
  const ownerSheetRows = [];

  for (const worksheet of workbook.worksheets) {
    if (worksheet.name === DETAIL_SHEET_NAME || worksheet.name === MASTER_SHEET_NAME) continue;
    const rows = parseSummarySheet(worksheet, worksheet.name);
    if (!rows.length) continue;
    ownerSheetRows.push(...rows);
    for (const row of rows) {
      ownerHints.set(asText(row.client_name), worksheet.name);
    }
  }

  const summaryRows = masterSheet
    ? parseSummarySheet(masterSheet).map((row) => ({
        ...row,
        owner_name: ownerHints.get(asText(row.client_name)) || row.owner_name || derivePrimaryOwnerName(row.bcba_name),
      }))
    : ownerSheetRows;

  const months = Array.from(new Set([...detailRows.map((row) => row.month), ...summaryRows.map((row) => row.month)].filter(Boolean)));
  const warnings = [];
  if (!detailRows.length) warnings.push('No detail rows were found. The Detail sheet will be empty unless your source workbook includes a 97155 detail tab.');
  if (!summaryRows.length) warnings.push('No master or owner summary rows were found. The source workbook needs an "In-Person by Client" sheet or owner-specific tabs.');

  return {
    detailRows,
    summaryRows,
    ownerHints,
    sheetNames,
    months,
    warnings,
  };
}

module.exports = {
  parse97155Workbook,
};
