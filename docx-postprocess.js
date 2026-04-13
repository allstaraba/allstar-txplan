'use strict';

const AdmZip = require('adm-zip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// ---------------------------------------------------------------------------
// Helper: get local tag name (strip namespace)
// ---------------------------------------------------------------------------
function localName(node) {
  const tag = node.nodeName || node.tagName || '';
  const idx = tag.indexOf(':');
  return idx >= 0 ? tag.slice(idx + 1) : tag;
}

// ---------------------------------------------------------------------------
// Helper: collect all text content from a node (recursive, like Python iter(t))
// ---------------------------------------------------------------------------
function allText(node) {
  if (!node) return '';
  let out = '';
  const tEls = node.getElementsByTagNameNS(W, 't');
  for (let i = 0; i < tEls.length; i++) {
    out += tEls[i].textContent || '';
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helper: direct children of a node with a given local name (in W namespace)
// ---------------------------------------------------------------------------
function directChildrenNS(node, localNameStr) {
  const result = [];
  if (!node || !node.childNodes) return result;
  for (let i = 0; i < node.childNodes.length; i++) {
    const ch = node.childNodes[i];
    if (ch.nodeType === 1 && ch.namespaceURI === W && localName(ch) === localNameStr) {
      result.push(ch);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Helper: find first direct child in W namespace with given local name
// ---------------------------------------------------------------------------
function directChildNS(node, localNameStr) {
  const all = directChildrenNS(node, localNameStr);
  return all.length ? all[0] : null;
}

// ---------------------------------------------------------------------------
// Helper: find first descendant (including self) in W namespace
// ---------------------------------------------------------------------------
function findNS(node, localNameStr) {
  if (!node) return null;
  if (node.nodeType === 1 && node.namespaceURI === W && localName(node) === localNameStr) {
    return node;
  }
  const els = node.getElementsByTagNameNS(W, localNameStr);
  return els.length ? els[0] : null;
}

// ---------------------------------------------------------------------------
// Helper: get w:val attribute
// ---------------------------------------------------------------------------
function getWVal(el) {
  if (!el) return '';
  return el.getAttributeNS(W, 'val') || el.getAttribute('w:val') || '';
}

// ---------------------------------------------------------------------------
// Helper: set w:val attribute
// ---------------------------------------------------------------------------
function setWVal(el, value) {
  el.setAttributeNS(W, 'w:val', value);
}

// ---------------------------------------------------------------------------
// Helper: get w:XXX attribute (any attr in W namespace)
// ---------------------------------------------------------------------------
function getWAttr(el, attrName) {
  if (!el) return '';
  return el.getAttributeNS(W, attrName) || el.getAttribute('w:' + attrName) || '';
}

// ---------------------------------------------------------------------------
// Helper: set w:XXX attribute
// ---------------------------------------------------------------------------
function setWAttr(el, attrName, value) {
  el.setAttributeNS(W, 'w:' + attrName, value);
}

// ---------------------------------------------------------------------------
// Helper: get body's direct children as an array
// ---------------------------------------------------------------------------
function getBodyChildren(body) {
  const result = [];
  for (let i = 0; i < body.childNodes.length; i++) {
    if (body.childNodes[i].nodeType === 1) result.push(body.childNodes[i]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Helper: get index of child in parent (among element children)
// ---------------------------------------------------------------------------
function childIndex(parent, child) {
  const children = getBodyChildren(parent);
  return children.indexOf(child);
}

// ---------------------------------------------------------------------------
// Helper: parse an XML string and import into doc
// ---------------------------------------------------------------------------
function parseAndImport(doc, xmlStr) {
  const parsed = new DOMParser().parseFromString(xmlStr, 'text/xml');
  return doc.importNode(parsed.documentElement, true);
}

// ---------------------------------------------------------------------------
// Helper: make a <w:br> run  (optionally copying rPr)
// ---------------------------------------------------------------------------
function makeBrRun(doc, rPr) {
  const run = doc.createElementNS(W, 'w:r');
  if (rPr) {
    run.appendChild(rPr.cloneNode(true));
  }
  run.appendChild(doc.createElementNS(W, 'w:br'));
  return run;
}

// ---------------------------------------------------------------------------
// Helper: make a <w:r> with text
// ---------------------------------------------------------------------------
function makeTextRun(doc, text, rPr, bold) {
  const run = doc.createElementNS(W, 'w:r');
  let rprClone;
  if (rPr) {
    rprClone = rPr.cloneNode(true);
  } else {
    rprClone = doc.createElementNS(W, 'w:rPr');
  }

  if (bold) {
    if (!findNS(rprClone, 'b')) {
      rprClone.appendChild(doc.createElementNS(W, 'w:b'));
    }
    if (!findNS(rprClone, 'bCs')) {
      rprClone.appendChild(doc.createElementNS(W, 'w:bCs'));
    }
  } else {
    // remove bold
    const bEls = rprClone.getElementsByTagNameNS(W, 'b');
    // collect first, then remove (live NodeList)
    const toRemoveB = [];
    for (let i = 0; i < bEls.length; i++) toRemoveB.push(bEls[i]);
    for (const b of toRemoveB) {
      if (b.parentNode === rprClone) rprClone.removeChild(b);
    }
    const bcsEls = rprClone.getElementsByTagNameNS(W, 'bCs');
    const toRemoveBcs = [];
    for (let i = 0; i < bcsEls.length; i++) toRemoveBcs.push(bcsEls[i]);
    for (const bcs of toRemoveBcs) {
      if (bcs.parentNode === rprClone) rprClone.removeChild(bcs);
    }
  }

  run.appendChild(rprClone);
  const t = doc.createElementNS(W, 'w:t');
  t.textContent = text;
  t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
  run.appendChild(t);
  return run;
}

// ---------------------------------------------------------------------------
// Helper: build header table XML string and parse it
// ---------------------------------------------------------------------------
function makeHeaderTable(doc, text) {
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const xml = `<w:tbl xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:tblPr>
    <w:tblW w:w="9360" w:type="dxa"/>
    <w:tblBorders>
      <w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>
      <w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>
      <w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>
      <w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>
      <w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>
      <w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>
    </w:tblBorders>
    <w:tblCellMar>
      <w:left w:w="10" w:type="dxa"/>
      <w:right w:w="10" w:type="dxa"/>
    </w:tblCellMar>
    <w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="0"/>
  </w:tblPr>
  <w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid>
  <w:tr>
    <w:tblPrEx>
      <w:tblCellMar>
        <w:top w:w="0" w:type="dxa"/>
        <w:bottom w:w="0" w:type="dxa"/>
      </w:tblCellMar>
    </w:tblPrEx>
    <w:tc>
      <w:tcPr>
        <w:tcW w:w="9360" w:type="dxa"/>
        <w:tcBorders>
          <w:top w:val="single" w:sz="1" w:space="0" w:color="999999"/>
          <w:left w:val="single" w:sz="1" w:space="0" w:color="999999"/>
          <w:bottom w:val="single" w:sz="1" w:space="0" w:color="999999"/>
          <w:right w:val="single" w:sz="1" w:space="0" w:color="999999"/>
        </w:tcBorders>
        <w:shd w:val="clear" w:color="auto" w:fill="D9D9D9"/>
        <w:tcMar>
          <w:top w:w="55" w:type="dxa"/>
          <w:left w:w="90" w:type="dxa"/>
          <w:bottom w:w="55" w:type="dxa"/>
          <w:right w:w="90" w:type="dxa"/>
        </w:tcMar>
      </w:tcPr>
      <w:p>
        <w:pPr><w:jc w:val="center"/></w:pPr>
        <w:r>
          <w:rPr>
            <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>
            <w:b/><w:bCs/>
          </w:rPr>
          <w:t>${safe}</w:t>
        </w:r>
      </w:p>
    </w:tc>
  </w:tr>
</w:tbl>`;
  return parseAndImport(doc, xml);
}

// ---------------------------------------------------------------------------
// Helper: make a zero-spacing paragraph
// ---------------------------------------------------------------------------
function makeZeroPara(doc) {
  return parseAndImport(doc,
    '<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>'
  );
}

// ---------------------------------------------------------------------------
// Helper: is the element an empty paragraph?
// ---------------------------------------------------------------------------
function isEmptyPara(el) {
  if (el.nodeType !== 1) return false;
  if (localName(el) !== 'p') return false;
  return !allText(el).trim();
}

// ---------------------------------------------------------------------------
// Main post-process function
// ---------------------------------------------------------------------------
function postProcessDocxBuffer(inputBuffer) {
  try {
    const zip = new AdmZip(inputBuffer);
    const entry = zip.getEntry('word/document.xml');
    if (!entry) {
      console.error('docx-postprocess: word/document.xml not found in zip');
      return inputBuffer;
    }

    const xmlRaw = entry.getData().toString('utf8');
    const doc = new DOMParser().parseFromString(xmlRaw, 'text/xml');
    const root = doc.documentElement;

    // Find body
    const bodyList = root.getElementsByTagNameNS(W, 'body');
    if (!bodyList.length) {
      console.error('docx-postprocess: w:body not found');
      return inputBuffer;
    }
    const body = bodyList[0];

    // -----------------------------------------------------------------------
    // FIX 1: Remove duplicate "ABA Treatment Plan" heading paragraphs and
    //         "reviewed the ABA treatment plan" tables from first 10 elements
    // -----------------------------------------------------------------------
    {
      const elements = getBodyChildren(body);
      const toRemove = [];
      for (let i = 0; i < Math.min(10, elements.length); i++) {
        const el = elements[i];
        const tag = localName(el);
        if (tag === 'p') {
          const txt = allText(el);
          if (txt.includes('ABA Treatment Plan') && i > 0) {
            toRemove.push(el);
          }
        } else if (tag === 'tbl') {
          const txt = allText(el).toLowerCase();
          if (txt.includes('reviewed the aba treatment plan')) {
            toRemove.push(el);
          }
        }
      }
      for (const el of toRemove) {
        if (el.parentNode === body) body.removeChild(el);
      }
    }

    // -----------------------------------------------------------------------
    // FIX 2: Replace known section-header bold paragraphs with header tables
    // -----------------------------------------------------------------------
    {
      const KNOWN_SECTION_HEADERS = new Set([
        'Current Family Structure', 'Medications', 'Medical History', 'School Placement',
        'History of ABA Services', 'Other Mental Health Services', 'Other Services',
        'Coordination of Care with Other Providers', 'Major Life Changes', 'Direct Observation',
        'Vineland Adaptive Behavior Scales, Third Edition (Vineland-3)',
        'Maladaptive Behavior Score Summary', 'Critical Items Endorsed',
        'Vineland-3 Clinical Interpretation', 'VB-MAPP Milestones Assessment',
        'VB-MAPP Barriers Assessment', 'VB-MAPP Assessment Narrative',
        'Social', 'Adaptive/Self-Care', 'Emergency & Clinical Contacts',
        'Requested CPT Codes', 'Anticipated Schedule', 'Attestation', 'Clinical Reviewer',
      ]);

      // Process in a snapshot; we'll manipulate body while iterating the snapshot
      const elements = getBodyChildren(body);
      for (const el of elements) {
        if (localName(el) !== 'p') continue;
        const txt = allText(el).trim();
        const hasBold = el.getElementsByTagNameNS(W, 'b').length > 0;
        if (hasBold && KNOWN_SECTION_HEADERS.has(txt)) {
          // Find reference node (current el) to insert before it
          const newTbl = makeHeaderTable(doc, txt);
          const zeroPara = makeZeroPara(doc);
          // Insert newTbl before el, then zeroPara before el, then remove el
          body.insertBefore(newTbl, el);
          body.insertBefore(zeroPara, el);
          body.removeChild(el);
        }
      }
    }

    // -----------------------------------------------------------------------
    // FIX 3: Center-align paragraphs in single-cell header-shaded rows
    // -----------------------------------------------------------------------
    {
      const tables = root.getElementsByTagNameNS(W, 'tbl');
      for (let ti = 0; ti < tables.length; ti++) {
        const tbl = tables[ti];
        const rows = directChildrenNS(tbl, 'tr');
        for (const row of rows) {
          const cells = directChildrenNS(row, 'tc');
          if (cells.length !== 1) continue;
          const shd = findNS(cells[0], 'shd');
          if (!shd) continue;
          const fill = getWAttr(shd, 'fill');
          if (fill !== 'D9D9D9' && fill !== '595959') continue;
          const paras = cells[0].getElementsByTagNameNS(W, 'p');
          for (let pi = 0; pi < paras.length; pi++) {
            const p = paras[pi];
            let pPr = directChildNS(p, 'pPr');
            if (!pPr) {
              pPr = doc.createElementNS(W, 'w:pPr');
              p.insertBefore(pPr, p.firstChild);
            }
            let jc = directChildNS(pPr, 'jc');
            if (!jc) {
              jc = doc.createElementNS(W, 'w:jc');
              pPr.appendChild(jc);
            }
            setWVal(jc, 'center');
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // FIX 4: Remove bold from first cell in non-header multi-cell rows (no gridSpan)
    // -----------------------------------------------------------------------
    {
      const tables = root.getElementsByTagNameNS(W, 'tbl');
      for (let ti = 0; ti < tables.length; ti++) {
        const tbl = tables[ti];
        const rows = directChildrenNS(tbl, 'tr');
        for (const row of rows) {
          const cells = directChildrenNS(row, 'tc');
          if (cells.length < 2) continue;
          const first = cells[0];
          const shd = findNS(first, 'shd');
          const fill = shd ? getWAttr(shd, 'fill') : '';
          if (fill === 'D9D9D9' || fill === '595959') continue;
          // Check gridSpan
          const tcPr = directChildNS(first, 'tcPr');
          const gs = tcPr ? directChildNS(tcPr, 'gridSpan') : null;
          if (gs) continue;
          // Remove b and bCs from first cell
          const bEls = Array.from(first.getElementsByTagNameNS(W, 'b'));
          for (const b of bEls) {
            if (b.parentNode) b.parentNode.removeChild(b);
          }
          const bcsEls = Array.from(first.getElementsByTagNameNS(W, 'bCs'));
          for (const bcs of bcsEls) {
            if (bcs.parentNode) bcs.parentNode.removeChild(bcs);
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // FIX 5: Merge "Medical Necessity Rationale" two-cell rows into one cell
    // -----------------------------------------------------------------------
    {
      const tables = Array.from(root.getElementsByTagNameNS(W, 'tbl'));
      for (const tbl of tables) {
        // Compute total grid width
        const gridColsNL = tbl.getElementsByTagNameNS(W, 'gridCol');
        // Only direct children of tblGrid
        const tblGrid = findNS(tbl, 'tblGrid');
        const gridCols = tblGrid ? directChildrenNS(tblGrid, 'gridCol') : [];
        let totalW = 0;
        for (const gc of gridCols) totalW += parseInt(getWAttr(gc, 'w') || '0', 10);

        const rows = directChildrenNS(tbl, 'tr');
        for (const row of rows) {
          const cells = directChildrenNS(row, 'tc');
          if (cells.length !== 2) continue;
          const leftTxt = allText(cells[0]);
          if (!leftTxt.includes('Medical Necessity Rationale')) continue;

          const rightCell = cells[1];
          const rightParas = directChildrenNS(rightCell, 'p');
          if (!rightParas.length) continue;

          // Ensure text starts with "Medical Necessity Rationale"
          const firstTxt = allText(rightCell).trim();
          if (!firstTxt.startsWith('Medical Necessity Rationale')) {
            const firstRun = rightParas[0].getElementsByTagNameNS(W, 'r')[0];
            if (firstRun) {
              const firstT = firstRun.getElementsByTagNameNS(W, 't')[0];
              if (firstT) {
                firstT.textContent = 'Medical Necessity Rationale: ' + (firstT.textContent || '');
              }
            }
          }

          // Build new tcPr
          const newTcPrXml = `<w:tcPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:tcW w:w="${totalW}" w:type="dxa"/>
  <w:gridSpan w:val="2"/>
  <w:tcBorders>
    <w:top w:val="single" w:sz="1" w:space="0" w:color="999999"/>
    <w:left w:val="single" w:sz="1" w:space="0" w:color="999999"/>
    <w:bottom w:val="single" w:sz="1" w:space="0" w:color="999999"/>
    <w:right w:val="single" w:sz="1" w:space="0" w:color="999999"/>
  </w:tcBorders>
  <w:tcMar>
    <w:top w:w="55" w:type="dxa"/>
    <w:left w:w="90" w:type="dxa"/>
    <w:bottom w:w="55" w:type="dxa"/>
    <w:right w:w="90" w:type="dxa"/>
  </w:tcMar>
</w:tcPr>`;
          const newTcPr = parseAndImport(doc, newTcPrXml);
          const oldTcPr = directChildNS(rightCell, 'tcPr');
          if (oldTcPr) rightCell.removeChild(oldTcPr);
          rightCell.insertBefore(newTcPr, rightCell.firstChild);

          // Remove left cell from row
          row.removeChild(cells[0]);

          // Split multi-run paragraphs with bullet points
          const parasNow = directChildrenNS(rightCell, 'p');
          for (const p of parasNow) {
            // Skip if already has <w:br>
            if (p.getElementsByTagNameNS(W, 'br').length > 0) continue;
            const directRuns = directChildrenNS(p, 'r');
            if (directRuns.length < 2) continue;

            const fullText = allText(p).trim();
            const rPr = directChildNS(directRuns[0], 'rPr');

            const bulletPattern = /(\u2022\s*)/;
            const rawParts = fullText.split(bulletPattern);
            const segments = [];
            if (rawParts[0].trim()) segments.push(rawParts[0].trim());
            let i = 1;
            while (i < rawParts.length) {
              const bullet = rawParts[i];
              const textPart = (i + 1 < rawParts.length) ? rawParts[i + 1].trim() : '';
              segments.push((bullet + textPart).trim());
              i += 2;
            }
            if (segments.length <= 1) continue;

            // Remove all direct runs
            for (const r of directRuns) p.removeChild(r);
            p.appendChild(makeTextRun(doc, segments[0], rPr, true));
            for (let s = 1; s < segments.length; s++) {
              p.appendChild(makeBrRun(doc, rPr));
              p.appendChild(makeTextRun(doc, segments[s], rPr, false));
            }
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // FIX 6: Remove single-column "Behavior Intervention Plan" tables with >5 rows
    // -----------------------------------------------------------------------
    {
      const elements = getBodyChildren(body);
      for (const el of elements) {
        if (localName(el) !== 'tbl') continue;
        const txt = allText(el);
        if (!txt.slice(0, 30).includes('Behavior Intervention Plan')) continue;
        const cols = el.getElementsByTagNameNS(W, 'gridCol');
        const rows = directChildrenNS(el, 'tr');
        if (cols.length === 1 && rows.length > 5) {
          if (el.parentNode === body) body.removeChild(el);
        }
      }
    }

    // -----------------------------------------------------------------------
    // FIX 7: Strip leading pipe characters from first cell of BIP tables
    // -----------------------------------------------------------------------
    {
      const tables = root.getElementsByTagNameNS(W, 'tbl');
      for (let ti = 0; ti < tables.length; ti++) {
        const tbl = tables[ti];
        const txt = allText(tbl);
        if (!txt.slice(0, 30).includes('Behavior Intervention Plan')) continue;
        const cols = tbl.getElementsByTagNameNS(W, 'gridCol');
        if (cols.length < 2) continue;
        const rows = directChildrenNS(tbl, 'tr');
        for (const row of rows) {
          const cells = directChildrenNS(row, 'tc');
          if (!cells.length) continue;
          const firstCell = cells[0];
          const tEls = firstCell.getElementsByTagNameNS(W, 't');
          for (let ti2 = 0; ti2 < tEls.length; ti2++) {
            const tEl = tEls[ti2];
            if (tEl.textContent && tEl.textContent.startsWith('|')) {
              tEl.textContent = tEl.textContent.replace(/^[| ]+/, '').trim();
            }
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // FIX 8: Merge header row of "Post-Crisis Procedures" table into one cell
    // -----------------------------------------------------------------------
    {
      const tables = root.getElementsByTagNameNS(W, 'tbl');
      for (let ti = 0; ti < tables.length; ti++) {
        const tbl = tables[ti];
        const txt = allText(tbl);
        if (!txt.slice(0, 25).includes('Post-Crisis Procedures')) continue;

        const tblGrid = findNS(tbl, 'tblGrid');
        const gridCols = tblGrid ? directChildrenNS(tblGrid, 'gridCol') : [];
        if (gridCols.length < 2) continue;

        let totalW = 0;
        for (const gc of gridCols) totalW += parseInt(getWAttr(gc, 'w') || '0', 10);

        const rows = directChildrenNS(tbl, 'tr');
        if (!rows.length) continue;
        const headerCells = directChildrenNS(rows[0], 'tc');
        if (!headerCells.length) continue;

        const cell = headerCells[0];
        let tcPr = directChildNS(cell, 'tcPr');
        if (!tcPr) {
          tcPr = doc.createElementNS(W, 'w:tcPr');
          cell.insertBefore(tcPr, cell.firstChild);
        }
        let tcW = directChildNS(tcPr, 'tcW');
        if (!tcW) {
          tcW = doc.createElementNS(W, 'w:tcW');
          tcPr.appendChild(tcW);
        }
        setWAttr(tcW, 'w', String(totalW));
        setWAttr(tcW, 'type', 'dxa');

        let gs = directChildNS(tcPr, 'gridSpan');
        if (!gs) {
          gs = doc.createElementNS(W, 'w:gridSpan');
          tcPr.appendChild(gs);
        }
        setWVal(gs, String(gridCols.length));
        break;
      }
    }

    // -----------------------------------------------------------------------
    // FIX 9: Merge content rows of "Generalization Protocol" / "Discharge Criteria" tables
    // -----------------------------------------------------------------------
    {
      const MERGE_TABLE_HEADERS = ['Generalization Protocol', 'Discharge Criteria'];
      const tables = Array.from(root.getElementsByTagNameNS(W, 'tbl'));
      for (const tbl of tables) {
        const txt = allText(tbl);
        if (!MERGE_TABLE_HEADERS.some(m => txt.slice(0, 30).includes(m))) continue;
        const rows = directChildrenNS(tbl, 'tr');
        if (rows.length < 3) continue;

        const tblGrid = findNS(tbl, 'tblGrid');
        const gridCols = tblGrid ? directChildrenNS(tblGrid, 'gridCol') : [];
        let totalW = 0;
        for (const gc of gridCols) totalW += parseInt(getWAttr(gc, 'w') || '0', 10);

        const contentRows = rows.slice(1);
        const allParas = [];
        for (const row of contentRows) {
          const cells = directChildrenNS(row, 'tc');
          if (!cells.length) continue;
          const paras = directChildrenNS(cells[0], 'p');
          for (const p of paras) {
            if (allText(p).trim()) {
              allParas.push(p.cloneNode(true));
            }
          }
        }

        // Remove content rows
        for (const row of contentRows) {
          if (row.parentNode === tbl) tbl.removeChild(row);
        }

        // Build new tc
        const newTcXml = `<w:tc xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:tcPr>
    <w:tcW w:w="${totalW}" w:type="dxa"/>
    <w:tcBorders>
      <w:top w:val="single" w:sz="1" w:space="0" w:color="999999"/>
      <w:left w:val="single" w:sz="1" w:space="0" w:color="999999"/>
      <w:bottom w:val="single" w:sz="1" w:space="0" w:color="999999"/>
      <w:right w:val="single" w:sz="1" w:space="0" w:color="999999"/>
    </w:tcBorders>
    <w:tcMar>
      <w:top w:w="55" w:type="dxa"/>
      <w:left w:w="90" w:type="dxa"/>
      <w:bottom w:w="55" w:type="dxa"/>
      <w:right w:w="90" w:type="dxa"/>
    </w:tcMar>
  </w:tcPr>
</w:tc>`;
        const newTc = parseAndImport(doc, newTcXml);
        for (const p of allParas) {
          newTc.appendChild(doc.importNode(p, true));
        }
        // Append empty paragraph
        const emptyP = parseAndImport(doc, '<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>');
        newTc.appendChild(emptyP);

        const newTr = parseAndImport(doc, '<w:tr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>');
        newTr.appendChild(newTc);
        tbl.appendChild(newTr);
      }
    }

    // -----------------------------------------------------------------------
    // FIX 10: Merge "Phase" and "Criteria" columns in 4-column phase tables
    // -----------------------------------------------------------------------
    {
      const tables = Array.from(root.getElementsByTagNameNS(W, 'tbl'));
      for (const tbl of tables) {
        const tblGrid = findNS(tbl, 'tblGrid');
        if (!tblGrid) continue;
        const grid = directChildrenNS(tblGrid, 'gridCol');
        if (grid.length !== 4) continue;

        const rows = directChildrenNS(tbl, 'tr');
        if (!rows.length) continue;
        const headerCells = directChildrenNS(rows[0], 'tc');
        if (headerCells.length !== 4) continue;

        const headers = headerCells.map(c => allText(c).trim());
        if (headers[0] !== 'Phase' || headers[1] !== 'Criteria') continue;

        const phaseW = parseInt(getWAttr(grid[0], 'w') || '0', 10);
        const critW = parseInt(getWAttr(grid[1], 'w') || '0', 10);
        const mergedW = phaseW + critW;

        // Update grid
        setWAttr(grid[0], 'w', String(mergedW));
        tblGrid.removeChild(grid[1]);

        for (const row of rows) {
          const rowCells = directChildrenNS(row, 'tc');
          if (rowCells.length < 2) continue;
          const cell0 = rowCells[0];
          const cell1 = rowCells[1];
          const t0 = allText(cell0).trim();
          const t1 = allText(cell1).trim();

          if (t0 === 'Phase' && t1 === 'Criteria') {
            // Header row: just remove cell1
            row.removeChild(cell1);
          } else {
            // Data row
            // Bold "Phase N" runs in cell0
            const phaseParas = directChildrenNS(cell0, 'p');
            if (phaseParas.length) {
              const runs = directChildrenNS(phaseParas[0], 'r');
              for (const r of runs) {
                const rt = allText(r).trim();
                if (/^Phase \d+$/.test(rt)) {
                  let rPr = directChildNS(r, 'rPr');
                  if (!rPr) {
                    rPr = doc.createElementNS(W, 'w:rPr');
                    r.insertBefore(rPr, r.firstChild);
                  }
                  if (!findNS(rPr, 'b')) rPr.appendChild(doc.createElementNS(W, 'w:b'));
                  if (!findNS(rPr, 'bCs')) rPr.appendChild(doc.createElementNS(W, 'w:bCs'));
                }
              }
            }

            // Move non-empty paragraphs from cell1 to cell0, with numbered-list splitting
            const paras1 = directChildrenNS(cell1, 'p').filter(p => allText(p).trim());
            for (const cp of paras1) {
              const pRuns = directChildrenNS(cp, 'r');
              const fullTxt = allText(cp).trim();
              const rPr1 = pRuns.length ? directChildNS(pRuns[0], 'rPr') : null;

              const numPat = /(?<!\d)(\d+\.\s)/;
              const rawParts = fullTxt.split(/(?<!\d)(\d+\.\s)/);
              const segs = [];
              if (rawParts[0].trim()) segs.push(rawParts[0].trim());
              let i = 1;
              while (i < rawParts.length) {
                const n = rawParts[i];
                const t2 = (i + 1 < rawParts.length) ? rawParts[i + 1].trim() : '';
                segs.push(n + t2);
                i += 2;
              }

              if (segs.length > 1) {
                for (const r of pRuns) cp.removeChild(r);
                cp.appendChild(makeTextRun(doc, segs[0], rPr1, false));
                for (let s = 1; s < segs.length; s++) {
                  cp.appendChild(makeBrRun(doc, rPr1));
                  cp.appendChild(makeTextRun(doc, segs[s], rPr1, false));
                }
              }

              cell0.appendChild(cp.cloneNode(true));
            }

            row.removeChild(cell1);
          }

          // Update tcW of cell0
          let tcPr0 = directChildNS(cell0, 'tcPr');
          if (!tcPr0) {
            tcPr0 = doc.createElementNS(W, 'w:tcPr');
            cell0.insertBefore(tcPr0, cell0.firstChild);
          }
          let tcW0 = directChildNS(tcPr0, 'tcW');
          if (!tcW0) {
            tcW0 = doc.createElementNS(W, 'w:tcW');
            tcPr0.appendChild(tcW0);
          }
          setWAttr(tcW0, 'w', String(mergedW));
          setWAttr(tcW0, 'type', 'dxa');
        }

        break; // Only process first matching table
      }
    }

    // -----------------------------------------------------------------------
    // FIX 11: Split numbered protocol steps in behavior tables (3rd column)
    // -----------------------------------------------------------------------
    {
      const BEHAVIOR_KEYWORDS = ['Elopement', 'Physical Aggression', 'SIB', 'Mouthing', 'Physical stereotypy', 'Aggression'];
      const tables = root.getElementsByTagNameNS(W, 'tbl');
      for (let ti = 0; ti < tables.length; ti++) {
        const tbl = tables[ti];
        const txt = allText(tbl);
        if (!BEHAVIOR_KEYWORDS.some(kw => txt.includes(kw))) continue;
        const gridCols = tbl.getElementsByTagNameNS(W, 'gridCol');
        if (gridCols.length < 3) continue;

        const rows = directChildrenNS(tbl, 'tr');
        for (const row of rows) {
          const cells = directChildrenNS(row, 'tc');
          if (cells.length < 3) continue;
          const protoCell = cells[2];
          const paras = directChildrenNS(protoCell, 'p');
          for (const p of paras) {
            if (p.getElementsByTagNameNS(W, 'br').length > 0) continue;
            const directRuns = directChildrenNS(p, 'r');
            if (!directRuns.length) continue;
            const fullTxt = allText(p).trim();
            if (!/\(\d+\)/.test(fullTxt)) continue;

            const rPr = directChildNS(directRuns[0], 'rPr');
            const pattern = /(\(\d+\)\s*)/;
            const rawParts = fullTxt.split(pattern);
            const segs = [];
            if (rawParts[0].trim()) segs.push(rawParts[0].trim());
            let i = 1;
            while (i < rawParts.length) {
              const n = rawParts[i];
              const t2 = (i + 1 < rawParts.length) ? rawParts[i + 1].trim() : '';
              segs.push((n + t2).trim());
              i += 2;
            }
            if (segs.length <= 1) continue;

            for (const r of directRuns) p.removeChild(r);
            p.appendChild(makeTextRun(doc, segs[0], rPr, false));
            for (let s = 1; s < segs.length; s++) {
              p.appendChild(makeBrRun(doc, rPr));
              p.appendChild(makeTextRun(doc, segs[s], rPr, false));
            }
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // FIX 12: Collapse consecutive empty paragraphs to at most one, zero-spaced
    // -----------------------------------------------------------------------
    {
      const elements = getBodyChildren(body);
      const finalChildren = [];
      let consecEmpty = 0;

      for (const el of elements) {
        const tag = localName(el);
        if (tag === 'sectPr') {
          finalChildren.push(el);
          continue;
        }
        if (isEmptyPara(el)) {
          consecEmpty++;
          if (consecEmpty === 1) {
            // Zero-space it and keep
            let pPr = directChildNS(el, 'pPr');
            if (!pPr) {
              pPr = doc.createElementNS(W, 'w:pPr');
              el.appendChild(pPr);
            }
            let sp = directChildNS(pPr, 'spacing');
            if (!sp) {
              sp = doc.createElementNS(W, 'w:spacing');
              pPr.appendChild(sp);
            }
            setWAttr(sp, 'before', '0');
            setWAttr(sp, 'after', '0');
            finalChildren.push(el);
          }
          // else: drop it (consecEmpty > 1)
        } else {
          consecEmpty = 0;
          finalChildren.push(el);
        }
      }

      // Rebuild body children
      const allChildren = Array.from(body.childNodes);
      for (const ch of allChildren) {
        body.removeChild(ch);
      }
      for (const ch of finalChildren) {
        body.appendChild(ch);
      }
    }

    // -----------------------------------------------------------------------
    // FIX 13: Bold "Yes" cells in telehealth tables
    // -----------------------------------------------------------------------
    {
      const TELEHEALTH_KEYWORDS = [
        'Personnel Education', 'Technology and Data Confidentiality',
        'Implementation and Evaluation', 'Environmental Evaluation',
        'Capabilities of Participant', 'Standard of Care Considerations',
      ];
      const tables = root.getElementsByTagNameNS(W, 'tbl');
      for (let ti = 0; ti < tables.length; ti++) {
        const tbl = tables[ti];
        const txt = allText(tbl);
        if (!TELEHEALTH_KEYWORDS.some(kw => txt.includes(kw))) continue;

        const rows = directChildrenNS(tbl, 'tr');
        for (const row of rows) {
          const cells = directChildrenNS(row, 'tc');
          for (const cell of cells) {
            const ct = allText(cell).trim();
            if (ct !== 'Yes') continue;
            const runs = cell.getElementsByTagNameNS(W, 'r');
            for (let ri = 0; ri < runs.length; ri++) {
              const run = runs[ri];
              let rPr = directChildNS(run, 'rPr');
              if (!rPr) {
                rPr = doc.createElementNS(W, 'w:rPr');
                run.insertBefore(rPr, run.firstChild);
              }
              if (!findNS(rPr, 'b')) rPr.appendChild(doc.createElementNS(W, 'w:b'));
              if (!findNS(rPr, 'bCs')) rPr.appendChild(doc.createElementNS(W, 'w:bCs'));
            }
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // Serialize and repack
    // -----------------------------------------------------------------------
    const serialized = new XMLSerializer().serializeToString(doc);
    const newXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + serialized;
    zip.updateFile('word/document.xml', Buffer.from(newXml, 'utf8'));
    return zip.toBuffer();

  } catch (err) {
    console.error('docx-postprocess error:', err);
    return inputBuffer;
  }
}

module.exports = { postProcessDocxBuffer };
