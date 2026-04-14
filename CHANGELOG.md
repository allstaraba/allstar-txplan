# Changelog

Each entry includes a commit hash. To roll back to any point, say **"rollback to [entry name or hash]"** and it will be done.

---

## 2026-04-13 (latest)

### `6ed2056` — DOCX post-processing: 13-fix XML pass on every export
- Ported Python lxml post-processing script to JavaScript (`docx-postprocess.js`)
- Applied automatically on every DOCX export via `postProcessDocxBuffer()` injected into the export route
- Fixes include: table/row/cell cleanup, paragraph normalization, spacing fixes, and structural repairs to the generated Word XML

### `(pending)` — Fix "Unknown" client name appearing in BIP/fading plan sections
- Broader pre-generation name extraction: now tries client/child/patient/participant name patterns, plain "Name:" field, and a first-sentence proper-noun pattern
- Post-generation text fix: if name was "Unknown" during generation but the real name is found in the plan text afterward, replaces all occurrences of "Unknown" in the plan body before saving

---

### `(pending)` — Revise: true surgical edits via find/replace (no full rewrite)
- Revise now asks Claude for only the changed text as find/replace pairs (tiny JSON response), then applies them programmatically to the existing plan — Claude never rewrites the full document
- Whitespace-normalized fallback matching for robustness
- Falls back with a clear error if changes can't be applied (user can then use Regenerate)
- Removed SSE streaming from Revise — it's now a simple JSON request that completes in seconds

### `(pending)` — Two-button revision: Revise vs Regenerate
- Added **Revise** button (blue): applies only the specific changes mentioned in chat — keeps everything else exactly the same; single Claude call, much faster
- **Regenerate** button (dark): existing full-plan regeneration, renamed from "Regenerate Full Plan"
- New `POST /api/chat/:plan_id/targeted-revise` server endpoint with surgical edit system prompt
- Status bar shows "Applying targeted changes…" vs "Regenerating plan…" during each operation
- Empty chat hint text updated to explain the difference between the two buttons

---

## 2026-04-13

### `92c01db` — Fix client name extraction and DOCX export filename
- Stripped markdown underscores/pipes from extracted client names (was causing `_ Name _` in filenames)
- Sanitized download filename on frontend in ReviewRevise and ClientRecords to use `treatment-plan-Name-revN.docx` format
- Fixed docx Fix2 domain-header detection — was too broad, causing unrelated section headers (Parent, Social, Training, etc.) to merge with the next table; now only matches tables ending with "Goals"

### `2f30a5b` — Fading phase goals: broader/generalized targets
- Fading phase goals now require broader, generalized skill descriptions rather than repeating the same goal at a higher percentage

### `4e2e8f7` — Simplified fading phase structure
- Replaced Phase Criteria Rules with a simplified fading phase structure in the generation prompt

---

## 2026-04-12

### `2dae967` — CPT code calculation fix
- 97153 uses recommended hours; 97155 always calculated as 20% of 97153

### `9dcf46c` — Compliance output reframed as recommendations
- Compliance tool output changed from "denials" language to recommendations language

### `f1007ed` — Fix 3 generation bugs
- Fixed DSM-5 criterion formatting
- Fixed behavior reduction goal formatting
- Fixed schedule grid output

### `63d0e0c` — Supervision ratio justification always included
- Removed 15% threshold; supervision ratio justification paragraph always appears

### `9662ca5` — Carelon compliance gaps added
- Added Carelon-specific compliance requirements to system prompt and boilerplate

### `f24e224` — Standalone compliance tool
- Compliance tool made fully standalone — upload or paste a plan directly, no plan picker required

### `9480d8c` — Compliance tool + insurance template versioning
- Added full compliance checking tool
- Added version history for insurance templates
- Added compliance chat feature

### `c2a8eb6` — Document upload in insurance template editor
- Added ability to upload documents directly in the insurance template editor

### `1fe17cb` — Compliance checker (initial)
- Insurance templates and plan review compliance checker feature added

---

## 2026-04-11

### `cf30c37` — DOCX builder fixes, logo upload, audit log
- Fixed table rendering issues in exported DOCX
- Added company logo upload (appears centered on first page of DOCX)
- Added activity audit log page (admin only)

### `3da5d89` — DOCX post-processing fixes and prompt caching
- Added 4 post-processing passes on DOCX output: Medical Necessity merge, domain header prepend, Post-Crisis bullet merge, Telehealth table merge
- Added Anthropic prompt caching (`cache_control: ephemeral`) to all 4 generation calls

### `82cf014` — Strip AI preamble from plans
- AI preamble text (e.g. "Here is the treatment plan…") stripped before saving

### `0ad1370` — Fix logo upload auth
- Fixed logo upload sending wrong localStorage token key (was `token`, should be `allstar_token`)

### `e6d5eb5` — Keep generation running on client disconnect
- Generation continues and saves to DB even if user closes browser tab

### `b669087` — Logo header in DOCX + prop fix
- Logo appears in DOCX header on first page only
- Fixed ReviewRevise prop name mismatch causing live stream not to show

### `3c1f53e` — Fix empty default header in DOCX
- Fixed Word rejecting DOCX files when logo header had an empty default header section

### `1cac35c` — Fix goal count mismatch
- Goal Objective Summary table now shows the correct counted number of goals

### `4a2a2bb` — Authorization periods in client records
- Added authorization period tracking to client records

### `46d4511` — Reauth report generation
- Added re-authorization report generation from previous plan + new assessment documents

### `72cff12` — Mastery criteria enforcer
- Post-generation enforcer: FERB goals set to 90%, non-FERB goals set to 80%

### `807d15e` — Goal count fix (S3C included)
- Goals counted after all sections complete, including S3C goals

### `f31b894` — Save generation uploads to client documents
- Files uploaded during plan generation are permanently saved to the client's document library

---

## 2026-04-10

### `3891adf` — 4-step generation pipeline with parallel pairs
- Restructured generation into 4 steps with two parallel pairs for speed

### `3ce7b87` — Boilerplate extracted from system prompt
- Boilerplate text (attestations, consent, etc.) extracted from system prompt and injected post-generation

### `351ee88` — Stop Generating button
- Added button to abort an in-progress plan generation

### `8076b68` — Excel file upload support
- `.xlsx` and `.xls` files can now be uploaded; all sheets extracted as CSV text

### `6fde7d5` — Maryland Medicaid Telehealth Readiness Checklist
- Checklist added to all generated plans

### `4ecef75` — DOCX builder rewrite
- Full rewrite: Arial 11pt, D9D9D9 shading, real Word tables matching reference plan format exactly

### `6dbcee5` — Review & Revise rebuilt as chat
- Review & Revise page rebuilt as a persistent back-and-forth chat with Claude

### `6e12f6e` — Fix generation timeout on Railway
- Switched to SSE streaming to prevent Railway proxy timeout on long generations

### `abf2ef3` — Initial commit
- All Star ABA Treatment Plan Generator — initial working version
