'use strict';

const {
  Document, Packer, Paragraph, TextRun,
  Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType,
  ShadingType, convertInchesToTwip,
} = require('docx');

// ─── Layout constants (matching reference plan XML) ───────────────────────────
const FONT      = 'Times New Roman';
const BODY_SZ   = 24;   // 12pt in half-points (reference uses sz=24)
const TITLE_SZ  = 28;   // 14pt for main title
const BLACK     = '000000';
const GRAY_HD   = 'A6A6A6';  // reference: w:fill="A6A6A6"
const MARGIN    = convertInchesToTwip(1);
const PAGE_W    = 12240;
const TABLE_W   = 9360;  // standard table width in DXA
const COL2_L    = 4830;  // 2-col left (label) width
const COL2_R    = 4530;  // 2-col right (value) width

// ─── Borders (matching reference: sz=4, color=000000) ────────────────────────
const B_THIN  = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const B_NONE  = { style: BorderStyle.NONE,   size: 0, color: 'FFFFFF' };
const ALL_THIN = { top: B_THIN, bottom: B_THIN, left: B_THIN, right: B_THIN };
const ALL_NONE = { top: B_NONE, bottom: B_NONE, left: B_NONE, right: B_NONE };
const NO_SIDE  = { top: B_NONE, bottom: B_NONE, left: B_NONE, right: B_NONE };

// ─── Text helpers ─────────────────────────────────────────────────────────────
const strip = s => (s || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').trim();

function runs(text, bold = false) {
  const parts = (text || '').split(/(\*\*[^*]*\*\*)/);
  return parts.filter(Boolean).map(p =>
    p.startsWith('**') && p.endsWith('**')
      ? new TextRun({ text: p.slice(2, -2), font: FONT, size: BODY_SZ, bold: true,  color: BLACK })
      : new TextRun({ text: p,              font: FONT, size: BODY_SZ, bold,         color: BLACK })
  );
}

const gap = (after = 80) => new Paragraph({
  children: [new TextRun('')],
  spacing: { after },
});

const para = (text, opts = {}) => new Paragraph({
  children: opts.raw
    ? [new TextRun({ text: strip(text), font: FONT, size: opts.sz || BODY_SZ, bold: opts.bold || false, color: BLACK })]
    : runs(text, opts.bold),
  spacing: { before: opts.before || 0, after: opts.after !== undefined ? opts.after : 60 },
  alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
  indent: opts.indent ? { left: opts.indent } : undefined,
});

const bul = (text, lvl = 0) => new Paragraph({
  children: runs(text),
  bullet: { level: lvl },
  spacing: { after: 40 },
});

// ─── Cell helper ─────────────────────────────────────────────────────────────
function cell(children, widthDXA, { fill, borders, colspan } = {}) {
  return new TableCell({
    children: Array.isArray(children) ? children : [children],
    width: { size: widthDXA, type: WidthType.DXA },
    shading: fill ? { fill, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    borders: borders !== undefined ? borders : ALL_THIN,
    margins: { top: 55, bottom: 55, left: 90, right: 90 },
    columnSpan: colspan || 1,
  });
}

// ─── Section header table (shaded merged row, like reference plans) ───────────
function sectionHeaderTable(text) {
  const content = new Paragraph({
    children: [new TextRun({ text: strip(text), font: FONT, size: BODY_SZ, bold: true, color: BLACK })],
    spacing: { after: 0 },
  });
  return new Table({
    rows: [new TableRow({
      children: [cell(content, TABLE_W, { fill: GRAY_HD })],
    })],
    width: { size: TABLE_W, type: WidthType.DXA },
    columnWidths: [TABLE_W],
  });
}

// ─── 2-col section table (label:value rows, optional shaded header) ───────────
function buildSectionTable(headerText, fieldRows) {
  const rows = [];

  // Shaded header row (merged across both cols)
  if (headerText) {
    rows.push(new TableRow({
      children: [cell(
        new Paragraph({
          children: [new TextRun({ text: strip(headerText), font: FONT, size: BODY_SZ, bold: true, color: BLACK })],
          spacing: { after: 0 },
        }),
        TABLE_W,
        { fill: GRAY_HD, colspan: 2 }
      )],
    }));
  }

  // Field:value rows
  for (const { label, value, full } of fieldRows) {
    if (full !== undefined) {
      // Full-width merged row
      rows.push(new TableRow({
        children: [cell(
          new Paragraph({ children: runs(full), spacing: { after: 0 } }),
          TABLE_W, { colspan: 2 }
        )],
      }));
    } else {
      rows.push(new TableRow({
        children: [
          cell(new Paragraph({
            children: [new TextRun({ text: label, font: FONT, size: BODY_SZ, bold: true, color: BLACK })],
            spacing: { after: 0 },
          }), COL2_L),
          cell(new Paragraph({
            children: runs(value),
            spacing: { after: 0 },
          }), COL2_R),
        ],
      }));
    }
  }

  return [
    new Table({
      rows,
      width: { size: TABLE_W, type: WidthType.DXA },
      columnWidths: [COL2_L, COL2_R],
    }),
    gap(60),
  ];
}

// ─── Markdown table parser ────────────────────────────────────────────────────
function buildMarkdownTable(lines) {
  const rows = lines
    .map(l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()))
    .filter(row => !row.every(c => /^[-: ]+$/.test(c)));

  if (!rows.length) return [];

  const nCols    = Math.max(...rows.map(r => r.length));
  const colW     = Math.floor(TABLE_W / nCols);
  const lastColW = TABLE_W - colW * (nCols - 1);

  const firstRowIsBoldHeaders = rows[0].every(c => c.startsWith('**') && c.endsWith('**'));
  const isTwoCol = nCols === 2 && !firstRowIsBoldHeaders;

  const tableRows = rows.map((row, ri) => {
    const isHeader = firstRowIsBoldHeaders && ri === 0;
    while (row.length < nCols) row.push('');

    const cells = row.map((c, ci) => {
      const isBoldLabel = isTwoCol && ci === 0;
      const w = isTwoCol
        ? (ci === 0 ? COL2_L : COL2_R)
        : (ci === nCols - 1 ? lastColW : colW);

      return cell(
        new Paragraph({ children: runs(c, isHeader || isBoldLabel), spacing: { after: 0 } }),
        w,
        { fill: isHeader ? GRAY_HD : undefined }
      );
    });

    return new TableRow({ children: cells });
  });

  const colWidths = isTwoCol
    ? [COL2_L, COL2_R]
    : Array(nCols).fill(0).map((_, i) => i === nCols - 1 ? lastColW : colW);

  return [
    new Table({
      rows: tableRows,
      width: { size: TABLE_W, type: WidthType.DXA },
      columnWidths: colWidths,
    }),
    gap(80),
  ];
}

// ─── Goal block (2-col table matching reference format) ──────────────────────
function buildGoalTable(num, goalLines) {
  const rows = [];

  // Goal number header row (shaded)
  const firstLine = goalLines[0] || `Goal ${num}`;
  const goalNumText = num ? `Goal ${num}` : strip(firstLine);

  // First row: goal number shaded header
  rows.push(new TableRow({
    children: [cell(
      new Paragraph({
        children: [new TextRun({ text: goalNumText, font: FONT, size: BODY_SZ, bold: true, color: BLACK })],
        spacing: { after: 0 },
      }),
      TABLE_W, { fill: GRAY_HD, colspan: 2 }
    )],
  }));

  // Process remaining lines as field:value rows
  const contentLines = goalLines.slice(num ? 0 : 1);
  for (const line of contentLines) {
    const t = line.trim();
    if (!t) continue;

    const ci = t.indexOf(':');
    if (ci > 0 && ci < 60 && !t.startsWith('http')) {
      const label = t.slice(0, ci + 1);
      const value = t.slice(ci + 1).trim();
      rows.push(new TableRow({
        children: [
          cell(new Paragraph({
            children: [new TextRun({ text: label, font: FONT, size: BODY_SZ, bold: true, color: BLACK })],
            spacing: { after: 0 },
          }), COL2_L),
          cell(new Paragraph({
            children: runs(value),
            spacing: { after: 0 },
          }), COL2_R),
        ],
      }));
    } else if (/^[●•\-]\s/.test(t)) {
      // Bullet → merged row
      rows.push(new TableRow({
        children: [cell(
          new Paragraph({ children: runs('• ' + t.replace(/^[●•\-]\s*/, '')), spacing: { after: 0 } }),
          TABLE_W, { colspan: 2 }
        )],
      }));
    } else if (!/^Goal\s+\d+$/i.test(t)) {
      // Full text row
      rows.push(new TableRow({
        children: [cell(
          new Paragraph({ children: runs(t), spacing: { after: 0 } }),
          TABLE_W, { colspan: 2 }
        )],
      }));
    }
  }

  return [
    new Table({
      rows,
      width: { size: TABLE_W, type: WidthType.DXA },
      columnWidths: [COL2_L, COL2_R],
    }),
    gap(80),
  ];
}

// ─── Main parser ──────────────────────────────────────────────────────────────
function parseMarkdown(text) {
  const out   = [];
  const lines = text.split('\n');

  // Pre-pass: collect line types
  // We process in a state machine that groups content under ## sections
  let i = 0;

  // Title (centered bold)
  const title = strip(text.match(/^#\s+(.+)/m)?.[1] || 'ABA Treatment Plan');
  out.push(new Paragraph({
    children: [new TextRun({ text: title, font: FONT, size: TITLE_SZ, bold: true, color: BLACK })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 160 },
  }));

  // State: current section accumulator
  let sectionHeader = null;
  let sectionRows   = [];  // { label, value } or { full }

  function flushSection() {
    if (sectionHeader !== null || sectionRows.length > 0) {
      if (sectionRows.length > 0) {
        out.push(...buildSectionTable(sectionHeader, sectionRows));
      } else if (sectionHeader) {
        out.push(sectionHeaderTable(sectionHeader), gap(60));
      }
    }
    sectionHeader = null;
    sectionRows   = [];
  }

  while (i < lines.length) {
    const raw = lines[i];
    const t   = raw.trim();

    // Skip title line (already handled)
    if (t.startsWith('# ') && !t.startsWith('## ')) { i++; continue; }

    // H2 → start/flush section
    if (t.startsWith('## ') && !t.startsWith('### ')) {
      flushSection();
      sectionHeader = t.slice(3);
      i++;
      continue;
    }

    // H3 → sub-heading (flush section, output as bold para)
    if (t.startsWith('### ')) {
      flushSection();
      out.push(para(t.slice(4), { bold: true, before: 120, after: 60 }));
      i++;
      continue;
    }

    // Horizontal rule
    if (/^[-*]{3,}$/.test(t)) {
      flushSection();
      out.push(gap(80));
      i++;
      continue;
    }

    // Empty line — don't break sections
    if (!t) {
      // only add gap if NOT in a section
      if (!sectionHeader && sectionRows.length === 0) out.push(gap(40));
      i++;
      continue;
    }

    // Markdown table
    if (t.startsWith('|')) {
      flushSection();
      const tbl = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { tbl.push(lines[i]); i++; }
      out.push(...buildMarkdownTable(tbl));
      continue;
    }

    // Bullets
    if (/^[●•]\s/.test(t) || /^-\s/.test(t)) {
      const btext = t.replace(/^[●•\-]\s+/, '');
      if (sectionHeader !== null || sectionRows.length > 0) {
        sectionRows.push({ full: btext });
      } else {
        out.push(bul(btext));
      }
      i++; continue;
    }

    // Numbered items — detect goal blocks
    const nm = t.match(/^(\d+)\.\s+(.+)$/);
    if (nm) {
      const isGoal = /goal\s+statement/i.test(nm[2]) || /goal\s+statement/i.test(lines[i + 1] || '') ||
                     /goal\s+statement/i.test(lines[i + 2] || '');
      if (isGoal) {
        flushSection();
        const goalLines = [];
        i++;
        // Collect: the goal header line and all non-blank lines until we hit a new numbered goal or blank+numbered
        while (i < lines.length) {
          const nx = lines[i].trim();
          if (!nx) {
            // Check if next non-blank is a new numbered goal
            let j = i + 1;
            while (j < lines.length && !lines[j].trim()) j++;
            const nextLine = lines[j]?.trim() || '';
            if (/^\d+\.\s+/.test(nextLine)) { i++; break; }
            i++; continue;
          }
          if (/^\d+\.\s+/.test(nx) && /goal\s+statement/i.test(nx)) break;
          goalLines.push(nx);
          i++;
        }
        out.push(...buildGoalTable(nm[1], goalLines));
        continue;
      }

      // Regular numbered item — add to section or output as para
      if (sectionHeader !== null || sectionRows.length > 0) {
        sectionRows.push({ full: t });
      } else {
        out.push(para(t, { after: 40 }));
      }
      i++; continue;
    }

    // Field: value line (label: value pattern)
    const ci = t.indexOf(':');
    if (ci > 0 && ci < 55 && !t.startsWith('http') && !/^[A-Z].*\s+[A-Z].*:/.test(t.slice(ci + 1))) {
      const label = t.slice(0, ci + 1);
      const value = t.slice(ci + 1).trim();
      // Only treat as field:value if we're in a section context or value is short-ish
      if (sectionHeader !== null || sectionRows.length > 0) {
        sectionRows.push({ label, value });
        i++; continue;
      }
      // Outside a section: if value is non-empty, make a mini 2-col table
      if (value) {
        out.push(...buildSectionTable(null, [{ label, value }]));
        i++; continue;
      }
    }

    // Plain text
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

// ─── Public ───────────────────────────────────────────────────────────────────
function buildDocx(planText, clientName) {
  const children = planText && planText.trim() ? parseMarkdown(planText) : [para('(empty)')];

  return new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
          size: { width: PAGE_W, height: 15840 },
        },
      },
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
