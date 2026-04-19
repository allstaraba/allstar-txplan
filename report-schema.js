'use strict';

const DETAIL_SHEET_NAME = '97155 Billed Detail';
const MASTER_SHEET_NAME = 'In-Person by Client';

const DETAIL_COLUMNS = [
  { key: 'month', header: 'Month', width: 9 },
  { key: 'service_date', header: 'Date', width: 12 },
  { key: 'client_name', header: 'Client', width: 29 },
  { key: 'bcba_name', header: 'BCBA', width: 25 },
  { key: 'hours', header: 'Hours', width: 7 },
  { key: 'delivery_type', header: 'Delivery Type', width: 15 },
  { key: 'place_of_service', header: 'Place of Service', width: 32 },
  { key: 'modifier', header: 'Modifier', width: 10 },
  { key: 'note', header: 'Note', width: 18 },
];

const MASTER_COLUMNS = [
  { key: 'month', header: 'Month', width: 9 },
  { key: 'client_name', header: 'Client', width: 26.29 },
  { key: 'bcba_name', header: 'BCBA', width: 36.14 },
  { key: 'scheduled_97153_hours', header: '97153 Hrs Scheduled', width: 14.14 },
  { key: 'total_97155_needed', header: 'Total 97155 Needed', width: 17.43 },
  { key: 'total_97155_completed', header: 'Total 97155 Hrs Completed', width: 16.43 },
  { key: 'total_97155_still_needed', header: '97155 Hrs Still Needed (Total)', width: 24 },
  { key: 'in_person_97155_required', header: '97155 In-Person Required', width: 14.29 },
  { key: 'in_person_97155_completed', header: '97155 In-Person Hrs COMPLETED', width: 15.29 },
  { key: 'in_person_97155_still_needed', header: 'in-person hours still NEEDED', width: 18.29 },
  { key: 'telehealth_97155_completed', header: '97155 Telehealth Hrs COMPLETED', width: 19.29 },
  { key: 'status_97155', header: '97155 Status', width: 19 },
  { key: 'telehealth_97155_still_needed', header: 'telehealth hours still needed', width: 18.29 },
  { key: 'status_in_person', header: '25% In-Person Status', width: 16.14 },
  { key: 'status_overall', header: 'Overall Status', width: 16.71 },
  { key: 'note', header: 'Note', width: 18 },
];

const OWNER_COLUMNS = [
  { key: 'client_name', header: 'Client', width: 34.29 },
  { key: 'scheduled_97153_hours', header: '97153 Hrs Scheduled', width: 10.29 },
  { key: 'total_97155_needed', header: 'Total 97155 Needed', width: 10.86 },
  { key: 'total_97155_completed', header: 'Total 97155 Hrs completed', width: 14 },
  { key: 'total_97155_still_needed', header: '97155 Hrs Still Needed (Total)', width: 14.57 },
  { key: 'in_person_97155_required', header: '97155 In-Person Required', width: 15.14 },
  { key: 'in_person_97155_completed', header: '97155 In-Person Hrs completed', width: 15.14 },
  { key: 'in_person_97155_still_needed', header: 'in-person hours still needed', width: 15.14 },
  { key: 'telehealth_97155_completed', header: '97155 Telehealth (GT) Hrs completed', width: 18.43 },
  { key: 'status_97155', header: '97155 Status', width: 12.71 },
  { key: 'telehealth_97155_still_needed', header: 'telehealth hours still needed', width: 15.86 },
  { key: 'status_in_person', header: '25% In-Person Status', width: 13.14 },
  { key: 'status_overall', header: 'Overall Status', width: 11.14 },
  { key: 'note', header: 'Note', width: 17.43 },
];

const REPORT_THEME = {
  fontName: 'Arial',
  detailHeaderFill: 'DDEFE8',
  masterHeaderFill: 'F8FAFC',
  childHeaderFill: '4472C4',
  childHeaderFont: 'FFFFFF',
  alternatingFill: 'D9E2F3',
  passFill: 'D6F5E6',
  warnFill: 'F7D6D9',
  borderColor: 'D1D5DB',
  thinBorder: 'thin',
};

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\(gt\)/g, 'gt')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function sanitizeSheetName(name, used = new Set()) {
  const base = String(name || 'Report')
    .replace(/[\\/?*:[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31) || 'Report';
  let candidate = base;
  let idx = 2;
  while (used.has(candidate)) {
    const suffix = ` ${idx}`;
    candidate = `${base.slice(0, Math.max(0, 31 - suffix.length))}${suffix}`;
    idx += 1;
  }
  used.add(candidate);
  return candidate;
}

module.exports = {
  DETAIL_SHEET_NAME,
  MASTER_SHEET_NAME,
  DETAIL_COLUMNS,
  MASTER_COLUMNS,
  OWNER_COLUMNS,
  REPORT_THEME,
  normalizeHeader,
  sanitizeSheetName,
};
