'use strict';

function round2(value) {
  const num = Number(value) || 0;
  return Math.round(num * 100) / 100;
}

function asNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  const cleaned = String(value).replace(/,/g, '').trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function asText(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function derivePrimaryOwnerName(bcbaName) {
  const text = asText(bcbaName);
  if (!text) return 'Unassigned';
  const primary = text.split('/')[0].trim();
  return primary || text;
}

function computeStatuses(row) {
  const totalCompleted = round2(row.total_97155_completed);
  const totalStillNeeded = round2(row.total_97155_still_needed);
  const inPersonStillNeeded = round2(row.in_person_97155_still_needed);

  let status97155 = 'Not Started';
  if (totalStillNeeded === 0) status97155 = 'Complete';
  else if (totalCompleted > 0) status97155 = '97155 started';

  const statusInPerson = inPersonStillNeeded === 0 ? 'PASS' : 'Incomplete';

  let statusOverall = 'Incomplete';
  if (totalStillNeeded === 0 && inPersonStillNeeded === 0) statusOverall = 'PASS';
  else if (totalCompleted > 0) statusOverall = 'PARTIAL';

  return {
    status_97155: status97155,
    status_in_person: statusInPerson,
    status_overall: statusOverall,
  };
}

function buildSummaryRows(detailRows = [], importedSummaryRows = [], ownerHints = new Map()) {
  if (Array.isArray(importedSummaryRows) && importedSummaryRows.length > 0) {
    return importedSummaryRows.map((row) => {
      const scheduled = round2(asNumber(row.scheduled_97153_hours));
      const totalNeeded = round2(scheduled * 0.1);
      const totalCompleted = round2(asNumber(row.total_97155_completed));
      const inPersonRequired = round2(totalNeeded * 0.25);
      const inPersonCompleted = round2(asNumber(row.in_person_97155_completed));
      const telehealthCompleted = round2(asNumber(row.telehealth_97155_completed));
      const totalStillNeeded = round2(Math.max(totalNeeded - totalCompleted, 0));
      const inPersonStillNeeded = round2(Math.max(inPersonRequired - inPersonCompleted, 0));
      const telehealthStillNeeded = round2(Math.max(totalStillNeeded - inPersonStillNeeded, 0));
      const ownerName = asText(row.owner_name) || ownerHints.get(asText(row.client_name)) || derivePrimaryOwnerName(row.bcba_name);

      return {
        month: asText(row.month),
        client_name: asText(row.client_name),
        bcba_name: asText(row.bcba_name),
        owner_name: ownerName,
        scheduled_97153_hours: scheduled,
        total_97155_needed: totalNeeded,
        total_97155_completed: totalCompleted,
        total_97155_still_needed: totalStillNeeded,
        in_person_97155_required: inPersonRequired,
        in_person_97155_completed: inPersonCompleted,
        in_person_97155_still_needed: inPersonStillNeeded,
        telehealth_97155_completed: telehealthCompleted,
        telehealth_97155_still_needed: telehealthStillNeeded,
        note: asText(row.note),
        ...computeStatuses({
          total_97155_completed: totalCompleted,
          total_97155_still_needed: totalStillNeeded,
          in_person_97155_still_needed: inPersonStillNeeded,
        }),
      };
    });
  }

  const grouped = new Map();
  for (const row of detailRows) {
    const key = `${asText(row.month)}__${asText(row.client_name)}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        month: asText(row.month),
        client_name: asText(row.client_name),
        bcba_name: asText(row.bcba_name),
        owner_name: ownerHints.get(asText(row.client_name)) || derivePrimaryOwnerName(row.bcba_name),
        scheduled_97153_hours: round2(asNumber(row.scheduled_97153_hours)),
        total_97155_completed: 0,
        in_person_97155_completed: 0,
        telehealth_97155_completed: 0,
        note: '',
      });
    }
    const current = grouped.get(key);
    const hours = round2(asNumber(row.hours));
    current.total_97155_completed = round2(current.total_97155_completed + hours);
    if (asText(row.delivery_type).toLowerCase() === 'telehealth') {
      current.telehealth_97155_completed = round2(current.telehealth_97155_completed + hours);
    } else {
      current.in_person_97155_completed = round2(current.in_person_97155_completed + hours);
    }
  }

  return Array.from(grouped.values()).map((row) => {
    const totalNeeded = round2(row.scheduled_97153_hours * 0.1);
    const totalStillNeeded = round2(Math.max(totalNeeded - row.total_97155_completed, 0));
    const inPersonRequired = round2(totalNeeded * 0.25);
    const inPersonStillNeeded = round2(Math.max(inPersonRequired - row.in_person_97155_completed, 0));
    const telehealthStillNeeded = round2(Math.max(totalStillNeeded - inPersonStillNeeded, 0));
    return {
      ...row,
      total_97155_needed: totalNeeded,
      total_97155_still_needed: totalStillNeeded,
      in_person_97155_required: inPersonRequired,
      in_person_97155_still_needed: inPersonStillNeeded,
      telehealth_97155_still_needed: telehealthStillNeeded,
      ...computeStatuses({
        total_97155_completed: row.total_97155_completed,
        total_97155_still_needed: totalStillNeeded,
        in_person_97155_still_needed: inPersonStillNeeded,
      }),
    };
  });
}

function buildOwnerReports(summaryRows) {
  const groups = new Map();
  for (const row of summaryRows) {
    const owner = asText(row.owner_name) || derivePrimaryOwnerName(row.bcba_name);
    if (!groups.has(owner)) groups.set(owner, []);
    groups.get(owner).push(row);
  }

  return Array.from(groups.entries())
    .map(([owner_name, rows]) => ({
      owner_name,
      rows: rows.sort((a, b) => a.client_name.localeCompare(b.client_name)),
      totals: {
        clients: rows.length,
        scheduled_97153_hours: round2(rows.reduce((sum, row) => sum + asNumber(row.scheduled_97153_hours), 0)),
        total_97155_needed: round2(rows.reduce((sum, row) => sum + asNumber(row.total_97155_needed), 0)),
        total_97155_completed: round2(rows.reduce((sum, row) => sum + asNumber(row.total_97155_completed), 0)),
      },
    }))
    .sort((a, b) => a.owner_name.localeCompare(b.owner_name));
}

module.exports = {
  asNumber,
  asText,
  round2,
  derivePrimaryOwnerName,
  buildSummaryRows,
  buildOwnerReports,
};
