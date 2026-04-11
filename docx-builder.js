'use strict';

const {
  Document, Packer, Paragraph, TextRun,
  Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType,
  ShadingType, convertInchesToTwip,
  Header, ImageRun,
} = require('docx');

// ─── Layout constants (matching reference plan XML exactly) ──────────────────
const FONT      = 'Arial';
const BODY_SZ   = 22;     // 11pt in half-points (reference: w:sz=22)
const BLACK     = '000000';
const GRAY_HD   = 'D9D9D9';  // reference: w:fill="D9D9D9"
const PAGE_W    = 12240;     // reference: w:pgSz w:w="12240"
const PAGE_H    = 15840;
const MARGIN    = 1200;      // reference: w:pgMar top/right/bottom/left="1200"
const TABLE_W   = 9360;      // reference: w:tblW w:w="9360"
const COL2_L    = 4000;      // reference: left col = 4000
const COL2_R    = 5360;      // reference: right col = 5360

// ─── Border specs (matching reference exactly) ────────────────────────────────
// Outer table borders: single, color=auto, sz=4
// Cell borders: single, color=999999, sz=1
const OUTER_BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'auto' };
const CELL_BORDER  = { style: BorderStyle.SINGLE, size: 1, color: '999999' };
const NO_BORDER    = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };

const OUTER_BORDERS = {
  top: OUTER_BORDER, bottom: OUTER_BORDER,
  left: OUTER_BORDER, right: OUTER_BORDER,
  insideH: OUTER_BORDER, insideV: OUTER_BORDER,
};

const CELL_BORDERS = {
  top: CELL_BORDER, bottom: CELL_BORDER,
  left: CELL_BORDER, right: CELL_BORDER,
};

const NO_BORDERS = {
  top: NO_BORDER, bottom: NO_BORDER,
  left: NO_BORDER, right: NO_BORDER,
};

// ─── Domain header detection (Fix 1) ─────────────────────────────────────────
// Lines like **Language/Communication Goals** that precede goal tables
const DOMAIN_HDR_RE = /^\*\*([^*]+(?:Goals?|Training Goals?|Training|Reduction Goals?))\*\*\s*$/i;

// Generic column labels that should be skipped as table headers (Fix 2)
const GENERIC_COL_LABELS = new Set([
  'field', 'details', 'item', 'description', 'value', 'label',
  'category', 'section', 'information', 'notes', 'response', 'answer', 'status',
]);

// ─── Text helpers ─────────────────────────────────────────────────────────────
const strip = s => (s || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').trim();

// Parse inline **bold** and return array of TextRun objects
function runs(text, defaultBold = false) {
  if (!text) return [new TextRun({ text: '', font: FONT, size: BODY_SZ, color: BLACK })];
  const parts = text.split(/(\*\*[^*]*\*\*)/);
  return parts.filter(p => p !== '').map(p => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return new TextRun({ text: p.slice(2, -2), font: FONT, size: BODY_SZ, bold: true, color: BLACK });
    }
    return new TextRun({ text: p, font: FONT, size: BODY_SZ, bold: defaultBold, color: BLACK });
  });
}

// Small gap paragraph
const gap = (after = 80) => new Paragraph({
  children: [new TextRun({ text: '', font: FONT, size: BODY_SZ })],
  spacing: { after },
});

// Standalone paragraph
const para = (text, opts = {}) => new Paragraph({
  children: opts.raw
    ? [new TextRun({ text: strip(text), font: FONT, size: opts.sz || BODY_SZ, bold: !!opts.bold, color: BLACK })]
    : runs(text, !!opts.bold),
  spacing: { before: opts.before || 0, after: opts.after !== undefined ? opts.after : 60 },
  alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
  indent: opts.indent ? { left: opts.indent } : undefined,
});

// Bullet paragraph
const bul = (text, lvl = 0) => new Paragraph({
  children: runs(text),
  bullet: { level: lvl },
  spacing: { after: 40 },
});

// ─── Cell helper ──────────────────────────────────────────────────────────────
function cell(children, widthDXA, opts = {}) {
  const { fill, colspan, noBorders } = opts;
  const cellChildren = Array.isArray(children) ? children : [children];
  return new TableCell({
    children: cellChildren,
    width: { size: widthDXA, type: WidthType.DXA },
    shading: fill ? { fill, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    borders: noBorders ? NO_BORDERS : CELL_BORDERS,
    margins: { top: 55, bottom: 55, left: 90, right: 90 },
    columnSpan: colspan || 1,
  });
}

// ─── Make a text paragraph for use inside a cell ──────────────────────────────
function cellPara(text, bold = false, spacing = 0) {
  return new Paragraph({
    children: runs(text, bold),
    spacing: { after: spacing },
  });
}

function cellParaRaw(text, bold = false) {
  return new Paragraph({
    children: [new TextRun({ text: strip(text), font: FONT, size: BODY_SZ, bold, color: BLACK })],
    spacing: { after: 0 },
  });
}

// Multiple text paragraphs for a cell (when content has newlines/bullets)
function cellParas(textOrLines, bold = false) {
  if (typeof textOrLines === 'string') {
    // Split on literal \n markers in text
    const lines = textOrLines.split(/\n/);
    if (lines.length === 1) {
      return [cellPara(textOrLines, bold)];
    }
    return lines.map(l => cellPara(l.trim(), bold));
  }
  if (Array.isArray(textOrLines)) {
    return textOrLines.map(l => cellPara(l, bold));
  }
  return [cellPara(String(textOrLines), bold)];
}

// ─── Table builder helper ─────────────────────────────────────────────────────
// WeakMap stores the original rows array for each Table, used by postProcessTables
const _tableRows = new WeakMap();

function makeTable(rows, colWidths) {
  const table = new Table({
    rows,
    width: { size: TABLE_W, type: WidthType.DXA },
    columnWidths: colWidths,
    borders: OUTER_BORDERS,
  });
  _tableRows.set(table, rows);
  return table;
}

// ─── Section table: shaded merged header + field:value rows ──────────────────
//
// headerText: string (or null for no header)
// fieldRows: array of:
//   { label: string, value: string }       => 2-col row, label bold+shaded, value normal
//   { full: string|Paragraph[] }           => full-width merged row
//   { fullParagraphs: Paragraph[] }        => full-width merged row with pre-built paragraphs
//   { subheader: string }                  => full-width shaded bold row (sub-section header)
//   { colHeaders: string[] }               => shaded header row with multiple cols
//   { multiCol: string[], widths: number[] } => plain multi-col row
//
// ─── Pre-process: merge consecutive bullet { full } rows into one merged cell ──
// Fix 5: post-crisis bullets (and any 2+ consecutive bullet rows) land in one cell
function mergeBulletRuns(fieldRows) {
  const out = [];
  let i = 0;
  while (i < fieldRows.length) {
    const fr = fieldRows[i];
    const isBullet = fr.full && typeof fr.full === 'string' && fr.full.startsWith('• ');
    if (isBullet) {
      const bullets = [fr.full];
      let j = i + 1;
      while (j < fieldRows.length) {
        const nfr = fieldRows[j];
        if (nfr.full && typeof nfr.full === 'string' && nfr.full.startsWith('• ')) {
          bullets.push(nfr.full);
          j++;
        } else break;
      }
      if (bullets.length > 1) {
        out.push({
          fullParagraphs: bullets.map(b =>
            new Paragraph({ children: runs(b), spacing: { after: 40 } })
          ),
        });
        i = j;
        continue;
      }
    }
    out.push(fr);
    i++;
  }
  return out;
}

function buildSectionTable(headerText, fieldRows, colWidths) {
  const cwL = colWidths ? colWidths[0] : COL2_L;
  const cwR = colWidths ? colWidths[1] : COL2_R;
  const rows = [];
  fieldRows = mergeBulletRuns(fieldRows);  // Fix 5

  // Shaded merged header row
  if (headerText) {
    rows.push(new TableRow({
      children: [cell(
        cellParaRaw(headerText, true),
        TABLE_W, { fill: GRAY_HD, colspan: 2 }
      )],
    }));
  }

  for (const fr of fieldRows) {
    if (fr.label !== undefined) {
      // Label:value row — label cell is shaded+bold per reference
      rows.push(new TableRow({
        children: [
          cell(cellParaRaw(fr.label, true), cwL, { fill: GRAY_HD }),
          cell(cellPara(fr.value || ''), cwR),
        ],
      }));
    } else if (fr.subheader !== undefined) {
      // Sub-section header row (shaded, bold, full width)
      rows.push(new TableRow({
        children: [cell(cellParaRaw(fr.subheader, true), TABLE_W, { fill: GRAY_HD, colspan: 2 })],
      }));
    } else if (fr.fullParagraphs !== undefined) {
      rows.push(new TableRow({
        children: [cell(fr.fullParagraphs, TABLE_W, { colspan: 2 })],
      }));
    } else if (fr.full !== undefined) {
      const paras = typeof fr.full === 'string'
        ? [cellPara(fr.full)]
        : fr.full;
      rows.push(new TableRow({
        children: [cell(paras, TABLE_W, { colspan: 2 })],
      }));
    } else if (fr.colHeaders !== undefined) {
      // Multi-column header row (all shaded+bold)
      const n = fr.colHeaders.length;
      const cw = Math.floor(TABLE_W / n);
      const lastCw = TABLE_W - cw * (n - 1);
      rows.push(new TableRow({
        children: fr.colHeaders.map((h, i) =>
          cell(cellParaRaw(strip(h), true), i === n - 1 ? lastCw : cw, { fill: GRAY_HD })
        ),
      }));
    } else if (fr.multiCol !== undefined) {
      const cols = fr.multiCol;
      const widths = fr.widths;
      rows.push(new TableRow({
        children: cols.map((c, i) => cell(cellPara(c), widths ? widths[i] : Math.floor(TABLE_W / cols.length))),
      }));
    }
  }

  return rows;
}

// ─── Markdown table parser → Word Table ───────────────────────────────────────
function buildMarkdownTable(lines) {
  const rows = lines
    .map(l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()))
    .filter(row => !row.every(c => /^[-: ]+$/.test(c)));

  if (!rows.length) return [];

  // Fix 2: skip generic "Field | Details" style header rows
  const firstRowLabels = rows[0].map(c => c.trim().replace(/\*\*/g, '').toLowerCase());
  const isGenericHeader = firstRowLabels.length > 0 && firstRowLabels.every(lbl => GENERIC_COL_LABELS.has(lbl));
  const workRows = isGenericHeader ? rows.slice(1) : rows;
  if (!workRows.length) return [];

  // Fix 3: Strengths/Challenges — if 3-col table has Strengths+Challenges headers,
  // drop the category column and keep only those two
  let finalRows = workRows;
  const hdr0 = workRows[0].map(c => c.trim().replace(/\*\*/g, '').toLowerCase());
  const hasStrengths = hdr0.some(h => /strength/i.test(h));
  const hasChallenges = hdr0.some(h => /challenge/i.test(h));
  if (workRows[0].length === 3 && hasStrengths && hasChallenges) {
    const strengthIdx = hdr0.findIndex(h => /strength/i.test(h));
    const challengeIdx = hdr0.findIndex(h => /challenge/i.test(h));
    finalRows = workRows.map(row => [
      row[strengthIdx] !== undefined ? row[strengthIdx] : '',
      row[challengeIdx] !== undefined ? row[challengeIdx] : '',
    ]);
  }

  const nCols = Math.max(...finalRows.map(r => r.length));
  const colW  = Math.floor(TABLE_W / nCols);
  const lastW = TABLE_W - colW * (nCols - 1);

  // Detect if first row has **bold** headers
  const firstRowBold = finalRows[0].every(c => {
    const t = c.trim();
    return (t.startsWith('**') && t.endsWith('**')) || t === '';
  });

  // For 2-col tables, use reference column widths
  const isTwoCol = nCols === 2;

  const colWidths = isTwoCol
    ? [COL2_L, COL2_R]
    : Array.from({ length: nCols }, (_, i) => i === nCols - 1 ? lastW : colW);

  const tableRows = finalRows.map((row, ri) => {
    const isHeader = firstRowBold && ri === 0;
    while (row.length < nCols) row.push('');

    const cells = row.map((c, ci) => {
      const w = colWidths[ci];
      return cell(
        cellPara(c, isHeader),
        w,
        { fill: isHeader ? GRAY_HD : undefined }
      );
    });
    return new TableRow({ children: cells });
  });

  return [
    makeTable(tableRows, colWidths),
    gap(80),
  ];
}

// ─── Goal block → 2-col table (matches reference goal format) ────────────────
//
// goalNum: string/number or null
// goalLines: array of strings (content of the goal block)
//
// Each goal line can be:
//   "**Goal Statement:** text"          → label=bold shaded, value=text
//   "**(FERB) Goal Statement:** text"   → label=bold shaded, value=text
//   "**Baseline:** value"               → label=bold shaded, value=text
//   "**Date of Introduction:** value"   → label=bold shaded, value=text
//   "**Projected Mastery:** value"      → label=bold shaded, value=text
//   "**Progress Data:** value"          → label=bold shaded, value=text
//   "• bullet"                          → full-width merged row
//   plain text                          → full-width merged row
//
function buildGoalTable(goalNum, goalLines, domainHeader = null) {
  const rows = [];

  // Fix 1: domain header row (e.g., "Language/Communication Goals") above goal
  if (domainHeader) {
    rows.push(new TableRow({
      children: [cell(cellParaRaw(domainHeader, true), TABLE_W, { fill: GRAY_HD, colspan: 2 })],
    }));
  }

  // Header row: "Goal N" shaded merged
  const headerText = goalNum ? `Goal ${goalNum}` : strip(goalLines[0] || 'Goal');
  rows.push(new TableRow({
    children: [cell(
      cellParaRaw(headerText, true),
      TABLE_W, { fill: GRAY_HD, colspan: 2 }
    )],
  }));

  // Parse a line to extract {label, value} or null
  function parseField(line) {
    // Pattern: **Label:** value  (bold markdown field)
    const boldM = line.match(/^\*\*(.+?):\*\*\s*(.*)/);
    if (boldM) {
      return { label: boldM[1].replace(/^\(FERB\)\s+/i, '(FERB) ') + ':', value: boldM[2].trimEnd().replace(/\s+$/, '') };
    }
    // Pattern: Plain Label: value (label up to 60 chars, no http)
    const ci = line.indexOf(':');
    if (ci > 0 && ci < 60 && !line.startsWith('http')) {
      const labelPart = line.slice(0, ci + 1);
      const valuePart = line.slice(ci + 1).trimStart().trimEnd().replace(/\s+$/, '');
      return { label: labelPart, value: valuePart };
    }
    return null;
  }

  // Content lines
  const contentLines = goalNum ? goalLines : goalLines.slice(1);
  let i = 0;
  while (i < contentLines.length) {
    const line = contentLines[i].trimEnd().replace(/\s+$/, '').trim();
    if (!line) { i++; continue; }

    // Skip redundant "Goal N" lines
    if (/^Goal\s+\d+$/i.test(line)) { i++; continue; }

    // Bullet line → full-width merged
    if (/^[●•\-]\s/.test(line)) {
      rows.push(new TableRow({
        children: [cell(
          new Paragraph({ children: runs('• ' + line.replace(/^[●•\-]\s*/, '')), spacing: { after: 0 } }),
          TABLE_W, { colspan: 2 }
        )],
      }));
      i++; continue;
    }

    // Field: value line
    const field = parseField(line);
    if (field) {
      const { label, value } = field;
      rows.push(new TableRow({
        children: [
          cell(cellParaRaw(label, true), COL2_L, { fill: GRAY_HD }),
          cell(cellPara(value), COL2_R),
        ],
      }));
      i++; continue;
    }

    // Full-text line → full-width merged
    rows.push(new TableRow({
      children: [cell(cellPara(line), TABLE_W, { colspan: 2 })],
    }));
    i++;
  }

  return [
    makeTable(rows, [COL2_L, COL2_R]),
    gap(80),
  ];
}

// ─── BIP block → 2-col table (matches reference BIP format) ──────────────────
//
// bipLines: array of strings forming a single BIP section
//
function buildBipTable(bipTitle, bipLines) {
  const rows = [];

  // Header: "Behavior Intervention Plan"
  rows.push(new TableRow({
    children: [cell(
      cellParaRaw('Behavior Intervention Plan', true),
      TABLE_W, { fill: GRAY_HD, colspan: 2 }
    )],
  }));

  // If we have a sub-title (e.g., the ### heading text), add it as a label row
  // Actually, process bipLines as field:value pairs
  let i = 0;
  while (i < bipLines.length) {
    const line = bipLines[i].trim();
    if (!line) { i++; continue; }

    // Field: value (bold label **Label:** followed by value)
    // Handles patterns like: **Target Behaviors:** text
    //                        **Date:** text
    const boldFieldMatch = line.match(/^\*\*([^*]+?):\*\*\s*(.*)/);
    if (boldFieldMatch) {
      const label = boldFieldMatch[1] + ':';
      const firstValue = boldFieldMatch[2].trim();

      // Collect continuation lines (bullets or plain lines until next **Field:**)
      const valueLines = firstValue ? [firstValue] : [];
      let j = i + 1;
      while (j < bipLines.length) {
        const next = bipLines[j].trim();
        if (!next) {
          // Check if the line after blank is another field
          let k = j + 1;
          while (k < bipLines.length && !bipLines[k].trim()) k++;
          const upcoming = (bipLines[k] || '').trim();
          if (/^\*\*[^*]+:\*\*/.test(upcoming)) break;
          if (upcoming) {
            valueLines.push('');
            j++;
            continue;
          }
          break;
        }
        if (/^\*\*[^*]+:\*\*/.test(next)) break;
        valueLines.push(next);
        j++;
      }

      // Build value paragraphs
      const valueParas = [];
      for (const vl of valueLines) {
        if (!vl) {
          valueParas.push(new Paragraph({ children: [new TextRun({ text: '', font: FONT, size: BODY_SZ })], spacing: { after: 0 } }));
          continue;
        }
        if (/^[●•\-]\s/.test(vl)) {
          valueParas.push(new Paragraph({ children: runs('• ' + vl.replace(/^[●•\-]\s*/, '')), spacing: { after: 0 } }));
        } else {
          valueParas.push(cellPara(vl));
        }
      }
      if (!valueParas.length) valueParas.push(cellPara(''));

      rows.push(new TableRow({
        children: [
          cell(cellParaRaw(label, true), COL2_L, { fill: GRAY_HD }),
          cell(valueParas.length === 1 ? valueParas[0] : valueParas, COL2_R),
        ],
      }));
      i = j;
      continue;
    }

    // Bullet line → full-width
    if (/^[●•\-]\s/.test(line)) {
      rows.push(new TableRow({
        children: [cell(
          new Paragraph({ children: runs('• ' + line.replace(/^[●•\-]\s*/, '')), spacing: { after: 0 } }),
          TABLE_W, { colspan: 2 }
        )],
      }));
      i++; continue;
    }

    // Plain line → full-width
    rows.push(new TableRow({
      children: [cell(cellPara(line), TABLE_W, { colspan: 2 })],
    }));
    i++;
  }

  return [
    makeTable(rows, [COL2_L, COL2_R]),
    gap(80),
  ];
}

// ─── Main markdown parser ─────────────────────────────────────────────────────
function parseMarkdown(text) {
  const out   = [];
  const lines = text.split('\n');
  let i = 0;

  // ── Title ──
  const titleMatch = text.match(/^#\s+(.+)/m);
  const title = strip(titleMatch ? titleMatch[1] : 'ABA Treatment Plan');
  out.push(new Paragraph({
    children: [new TextRun({ text: title, font: FONT, size: 32, bold: true, color: BLACK })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 200 },
  }));

  // ── State for accumulating section content ──
  let sectionHeader        = null;  // current ## heading text
  let sectionRows          = [];    // accumulated field rows
  let pendingParas         = [];    // standalone paragraphs/elements before flush
  let inBipSection         = false; // true when inside a ## Behavior Intervention Plan(s) section
  let pendingDomainHeader  = null;  // Fix 1: domain header to prepend to next goal table

  function flushSection() {
    if (sectionHeader !== null && sectionRows.length > 0) {
      const tableRows = buildSectionTable(sectionHeader, sectionRows);
      out.push(makeTable(tableRows, [COL2_L, COL2_R]));
      out.push(gap(80));
    } else if (sectionHeader !== null && sectionRows.length === 0) {
      // Header with no field rows — emit as standalone shaded header table
      const headerRow = new TableRow({
        children: [cell(cellParaRaw(sectionHeader, true), TABLE_W, { fill: GRAY_HD, colspan: 2 })],
      });
      out.push(makeTable([headerRow], [TABLE_W]));
      out.push(gap(60));
    }
    sectionHeader = null;
    sectionRows   = [];
    // Note: do NOT reset inBipSection here — it persists until a new ## section
  }

  // ── Process lines ──
  while (i < lines.length) {
    const raw = lines[i];
    const t   = raw.trim();

    // Skip title line (already handled)
    if (t.startsWith('# ') && !t.startsWith('## ')) { i++; continue; }

    // Checkbox lines (e.g., ☐ or ☑) — output as standalone para then skip
    if (t.startsWith('☐') || t.startsWith('☑') || t.startsWith('☒')) {
      flushSection();
      out.push(para(t, { after: 60 }));
      i++; continue;
    }

    // ── H2 section heading → flush + start new section ──
    if (t.startsWith('## ') && !t.startsWith('### ')) {
      flushSection();
      sectionHeader = t.slice(3).trim().replace(/^\d+\.\s+/, '');  // Fix 6: strip leading "N. "
      inBipSection = /^Behavior Intervention Plan/i.test(sectionHeader);
      i++;
      continue;
    }

    // ── H3 sub-heading ──
    if (t.startsWith('### ')) {
      // Check for BIP sub-headings: either we're in a BIP section OR the sub-title itself says BIP
      const subTitle = t.slice(4).trim();
      const isBip = inBipSection || /^Behavior Intervention Plan/i.test(sectionHeader || '');

      if (isBip) {
        // BIP sub-section: collect lines until next ### or ##
        flushSection();
        const bipLines = [];
        i++;
        while (i < lines.length) {
          const nx = lines[i].trim();
          if (nx.startsWith('## ') || nx.startsWith('### ')) break;
          bipLines.push(lines[i]);
          i++;
        }
        out.push(...buildBipTable(subTitle, bipLines));
        continue;
      }

      // Fix 4: telehealth section — absorb H3 as subheader row (keeps one table)
      if (sectionHeader && /telehealth/i.test(sectionHeader)) {
        sectionRows.push({ subheader: subTitle });
        i++;
        continue;
      }

      // Regular sub-heading: flush current section, emit as bold para
      flushSection();
      out.push(para(subTitle, { bold: true, before: 120, after: 60, raw: true }));
      i++;
      continue;
    }

    // ── Horizontal rule ──
    if (/^[-*]{3,}$/.test(t)) {
      flushSection();
      out.push(gap(80));
      i++; continue;
    }

    // ── Empty line ──
    if (!t) {
      // Don't break active sections with blank lines
      if (!sectionHeader && sectionRows.length === 0) out.push(gap(40));
      i++; continue;
    }

    // ── Markdown table ──
    if (t.startsWith('|')) {
      flushSection();
      const tblLines = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tblLines.push(lines[i]);
        i++;
      }
      out.push(...buildMarkdownTable(tblLines));
      continue;
    }

    // ── Numbered goal items ──
    // Pattern: "1. **Goal Statement:** ..." or "1. **(FERB) Goal Statement:** ..."
    const numGoalMatch = t.match(/^(\d+)\.\s+(\*\*(?:\(FERB\)\s+)?Goal Statement:\*\*\s*.*)/i);
    if (numGoalMatch) {
      flushSection();
      const goalNum = numGoalMatch[1];
      const goalFirstLine = numGoalMatch[2]; // "**Goal Statement:** ..."

      // Collect the goal block: lines until next numbered goal, ## heading, or **Goal N:**
      const goalLines = [goalFirstLine];
      i++;
      while (i < lines.length) {
        const nx = lines[i].trim();
        if (!nx) {
          // Peek ahead: is next non-blank a new section/goal?
          let j = i + 1;
          while (j < lines.length && !lines[j].trim()) j++;
          const upcoming = (lines[j] || '').trim();
          if (/^\d+\.\s+\*\*(?:\(FERB\)\s+)?Goal Statement:/i.test(upcoming) ||
              upcoming.startsWith('## ') ||
              upcoming.startsWith('### ') ||
              /^\*\*Goal\s+\d+:\*\*/i.test(upcoming)) {
            i++;
            break;
          }
          i++; continue;
        }
        // Break on new section heading or another numbered goal
        if (/^\d+\.\s+\*\*(?:\(FERB\)\s+)?Goal Statement:/i.test(nx)) break;
        if (nx.startsWith('## ') || nx.startsWith('### ')) break;
        if (/^\*\*Goal\s+\d+:\*\*/i.test(nx)) break;
        goalLines.push(nx);
        i++;
      }
      out.push(...buildGoalTable(goalNum, goalLines, pendingDomainHeader));
      pendingDomainHeader = null;
      continue;
    }

    // ── Behavior Reduction Goal block ──
    // Pattern: "**Goal N:** text..."
    const brGoalMatch = t.match(/^\*\*Goal\s+(\d+):\*\*\s*(.*)/i);
    if (brGoalMatch) {
      flushSection();
      const goalNum = brGoalMatch[1];
      const goalFirstLine = '**Goal Statement:** ' + brGoalMatch[2];
      const goalLines = [goalFirstLine];
      i++;
      while (i < lines.length) {
        const nx = lines[i].trim();
        if (!nx) {
          let j = i + 1;
          while (j < lines.length && !lines[j].trim()) j++;
          const upcoming = (lines[j] || '').trim();
          if (/^\*\*Goal\s+\d+:\*\*/i.test(upcoming) ||
              upcoming.startsWith('## ') ||
              upcoming.startsWith('### ')) {
            i++; break;
          }
          i++; continue;
        }
        if (/^\*\*Goal\s+\d+:\*\*/i.test(nx)) break;
        if (nx.startsWith('## ') || nx.startsWith('### ')) break;
        goalLines.push(nx);
        i++;
      }
      out.push(...buildGoalTable(goalNum, goalLines, pendingDomainHeader));
      pendingDomainHeader = null;
      continue;
    }

    // ── Caregiver/Parent Training Goal ──
    // Pattern: "**Goal N:** text..."  (same as brGoal above, already handled)

    // ── Bullets outside sections ──
    if (/^[●•]\s/.test(t) || /^-\s/.test(t)) {
      const btext = t.replace(/^[●•\-]\s+/, '');
      if (sectionHeader !== null || sectionRows.length > 0) {
        sectionRows.push({ full: '• ' + strip(btext) });
      } else {
        out.push(bul(btext));
      }
      i++; continue;
    }

    // ── Numbered list items (non-goal) ──
    const numMatch = t.match(/^(\d+)\.\s+(.+)$/);
    if (numMatch) {
      if (sectionHeader !== null || sectionRows.length > 0) {
        sectionRows.push({ full: t });
      } else {
        out.push(para(t, { after: 40 }));
      }
      i++; continue;
    }

    // ── Field: value lines ──
    // Match "Label:" value — but be careful: only if label portion is short
    const colonIdx = t.indexOf(':');
    if (colonIdx > 0 && colonIdx < 60 && !t.startsWith('http') && !t.startsWith('**')) {
      const label = t.slice(0, colonIdx + 1);
      const value = t.slice(colonIdx + 1).trim();
      if (sectionHeader !== null || sectionRows.length > 0) {
        sectionRows.push({ label, value });
      } else if (value) {
        // Outside a section: mini 2-col table
        const tblRows = buildSectionTable(null, [{ label, value }]);
        if (tblRows.length) {
          out.push(makeTable(tblRows, [COL2_L, COL2_R]));
          out.push(gap(60));
        }
      } else {
        out.push(para(t));
      }
      i++; continue;
    }

    // ── Bold field lines (e.g., **Label:** value) ──
    // These appear a lot in BIP and goal sections — outside a section, treat as para
    const boldFieldMatch = t.match(/^\*\*([^*]+?):\*\*\s*(.*)/);
    if (boldFieldMatch) {
      const label = boldFieldMatch[1] + ':';
      const value = boldFieldMatch[2].trim();
      if (sectionHeader !== null || sectionRows.length > 0) {
        sectionRows.push({ label: '**' + label + '**', value });
      } else {
        // Standalone bold field — flush nothing, just para
        out.push(para(t, { after: 40 }));
      }
      i++; continue;
    }

    // Fix 1: domain header lines (e.g., **Language/Communication Goals**)
    const domainMatch = t.match(DOMAIN_HDR_RE);
    if (domainMatch) {
      flushSection();
      pendingDomainHeader = domainMatch[1];
      i++; continue;
    }

    // ── Plain text ──
    if (sectionHeader !== null || sectionRows.length > 0) {
      sectionRows.push({ full: t });
    } else {
      out.push(para(t));
    }
    i++;
  }

  flushSection();
  return out;
}

// ─── Post-processing helpers ──────────────────────────────────────────────────

// Extract all plain text from a TableRow (all cells, all paragraphs, all runs)
function rowText(row) {
  if (!row || !row.root) return '';
  let text = '';
  for (const cel of row.root.filter(r => r && r.constructor && r.constructor.name === 'TableCell')) {
    for (const p of (cel.root || []).filter(r => r && r.constructor && r.constructor.name === 'Paragraph')) {
      for (const run of (p.root || []).filter(r => r && r.constructor && r.constructor.name === 'TextRun')) {
        const textNode = (run.root || []).find(r => r && r.constructor && r.constructor.name === 'Text');
        if (textNode) {
          const str = (textNode.root || []).find(r => typeof r === 'string');
          if (str) text += str;
        }
      }
    }
  }
  return text.trim();
}

// Get stored rows for a table
function getRows(tbl) {
  return _tableRows.get(tbl) || [];
}

// Advance index past any Paragraph elements; return index of next non-Paragraph
function skipParas(arr, from) {
  let i = from;
  while (i < arr.length && arr[i] instanceof Paragraph) i++;
  return i;
}

// ── Fix 1: Merge Medical Necessity section table + Goal table into one ─────────
// Detects: Table A whose first row text starts with "Medical Necessity",
// followed (after gaps) by Table B whose first row text matches a goal pattern.
function fix1MedNecGoal(arr) {
  const out = [];
  let i = 0;
  while (i < arr.length) {
    const el = arr[i];
    if (el instanceof Table) {
      const rows = getRows(el);
      const firstText = rows.length ? rowText(rows[0]) : '';
      if (/^Medical Necessity/i.test(firstText)) {
        const j = skipParas(arr, i + 1);
        if (j < arr.length && arr[j] instanceof Table) {
          const nextRows = getRows(arr[j]);
          const nextFirstText = nextRows.length ? rowText(nextRows[0]) : '';
          if (/^\d+\.|^\(FERB\)|^Goal\s+\d+/i.test(nextFirstText)) {
            out.push(makeTable([...rows, ...nextRows], [COL2_L, COL2_R]));
            out.push(gap(80));
            i = j + 1;
            if (i < arr.length && arr[i] instanceof Paragraph) i++; // skip trailing gap
            continue;
          }
        }
      }
    }
    out.push(el);
    i++;
  }
  return out;
}

// ── Fix 2: Prepend standalone domain header row into the following table ────────
// Detects: 1-row Table whose text matches domain names, followed by any table.
// Inserts that row as row 0 of the following table.
function fix2DomainHeaders(arr) {
  const DOMAIN_RE = /communication|social|adaptive|self-care|behavior reduction|parent|caregiver|training/i;
  const out = [];
  let i = 0;
  while (i < arr.length) {
    const el = arr[i];
    if (el instanceof Table) {
      const rows = getRows(el);
      const firstText = rows.length ? rowText(rows[0]) : '';
      if (rows.length === 1 && DOMAIN_RE.test(firstText)) {
        const j = skipParas(arr, i + 1);
        if (j < arr.length && arr[j] instanceof Table) {
          const nextRows = getRows(arr[j]);
          out.push(makeTable([...rows, ...nextRows], [COL2_L, COL2_R]));
          out.push(gap(80));
          i = j + 1;
          if (i < arr.length && arr[i] instanceof Paragraph) i++;
          continue;
        }
      }
    }
    out.push(el);
    i++;
  }
  return out;
}

// ── Fix 3: Merge Post-Crisis bullet rows into a single cell ───────────────────
// Detects: Table whose row 0 text contains "Post-Crisis" and has 2+ subsequent
// rows that are each a single bullet. Collapses those bullets into one merged cell.
function fix3PostCrisis(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const el = arr[i];
    if (el instanceof Table) {
      const rows = getRows(el);
      if (rows.length > 2) {
        const firstText = rows.length ? rowText(rows[0]) : '';
        if (/Post.?Crisis/i.test(firstText)) {
          const bulletRows = [];
          const headerRows = [rows[0]];
          for (let ri = 1; ri < rows.length; ri++) {
            const t = rowText(rows[ri]);
            if (/^[•\-●]/.test(t)) {
              bulletRows.push(t.replace(/^[•\-●]\s*/, ''));
            } else {
              headerRows.push(rows[ri]);
            }
          }
          if (bulletRows.length > 1) {
            const bulletParas = bulletRows.map(bt =>
              new Paragraph({ children: runs('• ' + bt), spacing: { after: 40 } })
            );
            const mergedRow = new TableRow({
              children: [cell(bulletParas, TABLE_W, { colspan: 2 })],
            });
            out.push(makeTable([...headerRows, mergedRow], [COL2_L, COL2_R]));
            continue;
          }
        }
      }
    }
    out.push(el);
  }
  return out;
}

// ── Fix 4: Merge Telehealth sub-tables into one continuous table ───────────────
// Detects: Table containing "Telehealth Readiness Checklist" in any row,
// then collects all immediately following tables whose first row matches sub-section
// header names, and merges them all into one table.
function fix4Telehealth(arr) {
  const SUB_RE = /Personnel|Technology|Implementation|Environmental|Capabilities|Standard of Care/i;
  const out = [];
  let i = 0;
  while (i < arr.length) {
    const el = arr[i];
    if (el instanceof Table) {
      const rows = getRows(el);
      const hasTelehealth = rows.some(r => /Telehealth Readiness Checklist/i.test(rowText(r)));
      if (hasTelehealth) {
        const allRows = [...rows];
        let j = i + 1;
        // Collect consecutive sub-tables, skipping gaps
        while (true) {
          j = skipParas(arr, j);
          if (j >= arr.length || !(arr[j] instanceof Table)) break;
          const subRows = getRows(arr[j]);
          const subFirstText = subRows.length ? rowText(subRows[0]) : '';
          if (!SUB_RE.test(subFirstText)) break;
          allRows.push(...subRows);
          j++;
        }
        out.push(makeTable(allRows, [COL2_L, COL2_R]));
        out.push(gap(80));
        i = j;
        if (i < arr.length && arr[i] instanceof Paragraph) i++;
        continue;
      }
    }
    out.push(el);
    i++;
  }
  return out;
}

// ── Main post-processor — runs all 4 fixes in sequence ────────────────────────
function postProcessTables(elements) {
  let arr = fix3PostCrisis(elements);  // Fix 3 first: within-table bullet merge
  arr = fix1MedNecGoal(arr);           // Fix 1: Medical Necessity + Goal merge
  arr = fix2DomainHeaders(arr);        // Fix 2: domain header prepend (runs after Fix 1)
  arr = fix4Telehealth(arr);           // Fix 4: telehealth sub-table merge
  return arr;
}

// ─── Public API ───────────────────────────────────────────────────────────────
function buildDocx(planText, clientName, logoBuffer = null) {
  const children = planText && planText.trim()
    ? postProcessTables(parseMarkdown(planText))
    : [para('(empty)')];

  const sectionHeaders = {};
  if (logoBuffer) {
    sectionHeaders.first = new Header({
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              data: logoBuffer,
              transformation: { width: 240, height: 72 }, // pixels; ~2.5in wide at 96dpi
            }),
          ],
        }),
      ],
    });
    sectionHeaders.default = new Header({ children: [] });
  }

  const sectionProps = {
    page: {
      margin: {
        top:    MARGIN,
        right:  MARGIN,
        bottom: MARGIN,
        left:   MARGIN,
        header: 708,
        footer: 708,
        gutter: 0,
      },
      size: { width: PAGE_W, height: PAGE_H },
    },
  };
  if (logoBuffer) sectionProps.titlePage = true;

  return new Document({
    sections: [{
      properties: sectionProps,
      ...(logoBuffer ? { headers: sectionHeaders } : {}),
      children,
    }],
    styles: {
      default: {
        document: {
          run: { font: FONT, size: BODY_SZ, color: BLACK },
        },
      },
    },
  });
}

module.exports = { buildDocx };
