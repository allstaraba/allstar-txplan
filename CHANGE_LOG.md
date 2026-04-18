# docx-builder Change Log

## How to switch back at any time

```bash
# Revert to BEFORE the April 17 2026 fix (old formatting)
git checkout 44264a1 -- docx-builder.js
git add docx-builder.js
git commit -m "Revert docx-builder to pre-April-17 state"
git push origin main

# Reapply the April 17 2026 fix (new formatting)
git checkout 79283bd -- docx-builder.js
git add docx-builder.js
git commit -m "Reapply April 17 docx-builder formatting fix"
git push origin main
```

---

## BEFORE — commit `44264a1` (pre April 17 2026)

State of `docx-builder.js` before the fix was applied.

**What it did:**
- MNR (Medical Necessity Rationale) rendered as a 2-cell row: left cell had the label, right cell had content. Word rendered this incorrectly — the 2 cells did not span the full width of the goal table grid, causing broken column layout.
- Goal tables generated from pipe-format rows (e.g. `| Goal Statement | text |`) went through `buildMarkdownTable` — no shaded labels, no proper goal styling.
- BIP header was always hardcoded as `"Behavior Intervention Plan"` regardless of the `###` heading text.
- Schedule grid: all columns equal width (narrow label).
- Checkboxes rendered as standalone paragraphs (no border).
- `## ` headings that look like domain names (e.g. `## Language/Communication Goals`) were treated as section headers, not as goal domain labels.
- Separator rows (`---:`) inside goal blocks were rendered as content.

---

## AFTER — commit `79283bd` (April 17 2026)

State of `docx-builder.js` after the fix was applied from `abaland` branch.

**What changed:**
- **MNR fix**: Medical Necessity Rationale cell is now a single full-width cell with `colspan:2`, matching the correct 2-column grid. This was the root fix that made everything look right.
- **Pipe-format goal routing**: Added `buildGoalTableFromPipeRows` — pipe rows that contain a numbered Goal Statement are now routed through `buildGoalTable`, giving them proper shaded labels and styled layout.
- **Separator row skip**: Lines matching `---` or `---:` inside goal blocks are now skipped instead of rendered as content.
- **BIP title**: Uses the actual `###` heading text as the BIP table header instead of hardcoded string.
- **Schedule grid**: 7+ column tables get a wider label column (1400 DXA) so day columns are readable.
- **Checkboxes**: Rendered inside a bordered table for consistent styling.
- **Domain header detection**: `## ` headings ending in "Goals" or "Training" are treated as `pendingDomainHeader` (prepended to the next goal table) instead of opening a new section.
- **`fix2DomainHeaders` update**: Broader pattern matching for domain header rows.

---

## Git history reference

| Commit    | Description |
|-----------|-------------|
| `79283bd` | **CURRENT** — April 17 2026 fix applied from abaland |
| `44264a1` | State just before April 17 fix (safe rollback target) |
| `6ae2879` | Added Fix 14 and Fix 15 to docx-postprocess.js |
| `d6bc92a` | Fixed 5 bugs found in audit |
| `ccc573d` | Fixed duplicate XML declaration |

---

## /regenerate refactor — April 18 2026

### How to roll back BEFORE the regenerate refactor

Tagged commit: `pre-regenerate-refactor-2026-04-18` (= commit `f7312f9`)

```bash
# Restore the OLD single-call regenerate route
git checkout pre-regenerate-refactor-2026-04-18 -- server.js
git add server.js
git commit -m "Revert regenerate route to pre-refactor (single-call) version"
git push origin main
```

### BEFORE — commit `f7312f9` (current, before refactor)

`/api/chat/:plan_id/regenerate` does ONE giant `anthropic.messages.stream()`
call with the full plan + feedback (~130K chars input). Has 4-attempt retry
on premature close, but each attempt is the full call — Anthropic's API
often closes the stream mid-response on inputs this large, causing
"Regeneration stream ended without confirmation" errors.

### AFTER — (about to be applied)

`/regenerate` will use the same sectioned pipeline as `/generate`:
S1 → S2 → [S3A ‖ S3B] → [S3C ‖ S3D1 ‖ S3D2]. Each section is a small
self-contained API call with its own retry. User feedback gets injected
into the system prompt for every section so the regeneration honors the
requested changes throughout.
