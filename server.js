require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const AdmZip = require('adm-zip');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const { Packer } = require('docx');
const { buildDocx } = require('./docx-builder');
const XLSX = require('xlsx');
const { injectBoilerplate, buildGoalSummaryTable } = require('./plan-boilerplate');
const { REAUTH_SYSTEM_PROMPT } = require('./reauth-prompt');
const { runBackup, latestBackup, BACKUP_DIR } = require('./backup');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'allstar-aba-secret-2026';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-5';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Server-side generation job tracking keyed by userId
// Survives client disconnects so users can reconnect and see status
const generationJobs = new Map(); // userId -> { status, section, total, label, planId, clientName, error, startedAt }

function setJob(userId, data) {
  generationJobs.set(userId, { ...generationJobs.get(userId), ...data });
}
function clearJob(userId) {
  generationJobs.delete(userId);
}
console.log(`[startup] Using model: ${CLAUDE_MODEL}`);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files from client/dist
app.use(express.static(path.join(__dirname, 'client', 'dist')));

// Uploads directory (use DATA_DIR for Railway volume persistence)
const DATA_DIR = process.env.DATA_DIR || __dirname;
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const TEMP_UPLOADS_DIR = path.join(DATA_DIR, 'uploads', 'temp');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(TEMP_UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR));

// Auth middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    req.token = token;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Admin middleware
function adminMiddleware(req, res, next) {
  if (req.user.role !== 'Admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Strip any AI preamble that appears before the actual plan heading
function stripAIPreamble(text) {
  const markers = ['# ABA Treatment Plan', '## ABA Treatment Plan', 'ABA Treatment Plan'];
  for (const marker of markers) {
    const idx = text.indexOf(marker);
    if (idx > 0) {
      return text.slice(idx);
    }
  }
  return text;
}

// Activity logger
function logActivity(userId, username, action, targetType = null, targetId = null, details = null) {
  try {
    db.prepare(
      'INSERT INTO activity_log (user_id, username, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(userId, username, action, targetType, targetId, details);
  } catch (e) {
    console.error('[activity_log] Failed to log:', e.message);
  }
}

// Multer memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Multer for logo uploads (PNG/JPG only, 5 MB max)
const uploadLogo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['image/png', 'image/jpeg', 'image/jpg'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PNG and JPG images are accepted'));
    }
  },
});

// ---- AUTH ROUTES ----

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    db.prepare('INSERT INTO sessions (user_id, token) VALUES (?, ?)').run(user.id, token);
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/logout', authMiddleware, (req, res) => {
  try {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
    res.json({ message: 'Logged out' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/me', authMiddleware, (req, res) => {
  try {
    const user = db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generation status endpoint — returns active job for the logged-in user
app.get('/api/generate/status', authMiddleware, (req, res) => {
  const job = generationJobs.get(req.user.id);
  if (!job) return res.json({ status: 'idle' });
  res.json(job);
});

// ---- CLIENT INFO SAVE/LOAD ----

app.get('/api/client-info/:plan_id', authMiddleware, (req, res) => {
  try {
    const row = db.prepare('SELECT data FROM client_info WHERE plan_id = ?').get(req.params.plan_id);
    if (!row) return res.json({});
    res.json(JSON.parse(row.data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/client-info/:plan_id', authMiddleware, (req, res) => {
  try {
    const { data } = req.body;
    if (!data) return res.status(400).json({ error: 'data is required' });
    db.prepare('INSERT OR REPLACE INTO client_info (plan_id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
      .run(req.params.plan_id, JSON.stringify(data));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- GENERATE ROUTE ----

function formatClientInfoForPrompt(clientInfo) {
  const sections = [
    { title: 'CLIENT INFORMATION', keys: ['client_full_name','date_of_birth','date_of_assessment','date_of_reassessment'] },
    { title: 'FAMILY STRUCTURE', keys: ['parent_guardian_name','parent_guardian_phone','parent_guardian_email','father_caregiver_name','siblings','marital_status','individuals_living_in_home','cultural_legal_issues','environmental_factors','safety_concerns'] },
    { title: 'MEDICATIONS', keys: ['medications'] },
    { title: 'MEDICAL HISTORY', keys: ['pcp_name','pcp_phone','allergies','medical_concerns','dietary_restrictions','surgery_history','er_history','family_mental_health_history'] },
    { title: 'BIRTH HISTORY', keys: ['pregnancy_complications','birth_concerns','delivery_method','weeks_gestation'] },
    { title: 'SCHOOL PLACEMENT', keys: ['school_name','school_setting','grade','school_schedule','school_hours_per_week'] },
    { title: 'ABA HISTORY', keys: ['prior_aba_history'] },
    { title: 'OTHER SERVICES', keys: ['other_mental_health_services','other_services_slp_ot'] },
    { title: 'COORDINATION OF CARE', keys: ['coordination_providers','major_life_changes'] },
    { title: 'OBSERVATION DETAILS', keys: ['observation_date','observation_start_time','observation_end_time','observation_location','individuals_present'] },
    { title: 'RECOMMENDED HOURS', keys: ['hours_97153','hours_97155','hours_97156','hours_97151','authorization_start_date','authorization_end_date','service_location'] },
    { title: 'PROVIDER INFORMATION', keys: ['supervising_bcba_name','supervising_bcba_credentials','supervising_bcba_phone'] },
    { title: 'EMERGENCY CONTACTS', keys: ['emergency_contact_name','emergency_contact_phone'] },
  ];

  const keyLabels = {
    client_full_name: 'Client Full Name', date_of_birth: 'Date of Birth',
    date_of_assessment: 'Date of Assessment', date_of_reassessment: 'Date of Reassessment',
    parent_guardian_name: 'Parent/Guardian Name', parent_guardian_phone: 'Parent/Guardian Phone',
    parent_guardian_email: 'Parent/Guardian Email', father_caregiver_name: 'Father/Caregiver Name',
    siblings: 'Siblings', marital_status: 'Marital Status',
    individuals_living_in_home: 'Individuals Living in Home', cultural_legal_issues: 'Cultural/Legal Issues',
    environmental_factors: 'Environmental Factors', safety_concerns: 'Safety Concerns',
    medications: 'Medications', pcp_name: 'PCP Name', pcp_phone: 'PCP Phone',
    allergies: 'Allergies', medical_concerns: 'Medical Concerns',
    dietary_restrictions: 'Dietary Restrictions', surgery_history: 'Surgery History',
    er_history: 'ER/Hospitalization History', family_mental_health_history: 'Family Mental Health History',
    pregnancy_complications: 'Pregnancy Complications', birth_concerns: 'Birth/Neonatal Concerns',
    delivery_method: 'Delivery Method', weeks_gestation: 'Weeks Gestation',
    school_name: 'School Name', school_setting: 'School Setting', grade: 'Grade',
    school_schedule: 'School Schedule', school_hours_per_week: 'School Hours Per Week',
    prior_aba_history: 'Prior ABA History', other_mental_health_services: 'Other Mental Health Services',
    other_services_slp_ot: 'Other Services (SLP/OT)', coordination_providers: 'Coordination Providers',
    major_life_changes: 'Major Life Changes', observation_date: 'Observation Date',
    observation_start_time: 'Observation Start Time', observation_end_time: 'Observation End Time',
    observation_location: 'Observation Location', individuals_present: 'Individuals Present',
    hours_97153: '97153 Direct BT Hours/Week', hours_97155: '97155-GT BCBA Hours/Week',
    hours_97156: '97156-GT Parent Training Hours/Week', hours_97151: '97151 Assessment Hours',
    authorization_start_date: 'Authorization Start Date', authorization_end_date: 'Authorization End Date',
    service_location: 'Service Location', supervising_bcba_name: 'Supervising BCBA Name',
    supervising_bcba_credentials: 'BCBA Credentials', supervising_bcba_phone: 'BCBA Phone',
    emergency_contact_name: 'Emergency Contact Name', emergency_contact_phone: 'Emergency Contact Phone',
  };

  const lines = ['=== VERIFIED CLIENT INFORMATION (confirmed by BCBA) ===', ''];
  for (const section of sections) {
    const sectionLines = [];
    for (const key of section.keys) {
      const val = clientInfo[key];
      if (val !== null && val !== undefined && String(val).trim() !== '') {
        sectionLines.push(`${keyLabels[key] || key}: ${val}`);
      }
    }
    if (sectionLines.length > 0) {
      lines.push(`${section.title}:`);
      lines.push(...sectionLines);
      lines.push('');
    }
  }
  return lines.join('\n');
}

// Generation pipeline:
//   S1 (seq)  → S2 (seq) → [S3A ‖ S3B] (parallel) → [S3C ‖ S3D] (parallel) → concatenate
const GEN = {
  S1: {
    id: 'S1',
    label: 'Client Info & Narrative (sections 1–9)',
    instruction: `Generate ONLY sections 1 through 9 of the ABA treatment plan:

1. "ABA Treatment Plan" title header
2. ☐ Review checkbox: "☐ I reviewed the ABA treatment plan requirements before submitting this report."
3. Client Information table (Name, DOB, Assessment Date, Reassessment Date, Guardian Contact)
4. Biopsychosocial Information: Current Family Structure table (include Environmental Factors and Safety Concerns rows), Medications table, Medical History table including Birth History, School Placement table
5. History of ABA Services table
6. Other Mental Health Services table and Other Services table
7. Coordination of Care — write '[COORDINATION_CARE_LANGUAGE]' in the bordered coordination text cell. Then the provider table. Write '[COORDINATION_NOTES_LANGUAGE]' in the coordination notes cell.
8. Major Life Changes table
9. Narrative section: Direct Observation table (Date, Start Time, End Time, Location, Individuals Present) + full Clinical Narrative in bordered table with domain sub-headers: Communication, Social, Adaptive/Safety Skills, Challenging Behaviors

Be thorough. Write full paragraphs. STOP after section 9. Do NOT write Strengths/Challenges, assessments, goals, BIPs, or any later sections.`,
  },

  S2: {
    id: 'S2',
    label: 'Assessments & Goal Summary (sections 10–14)',
    instruction: `Sections 1–9 have been written above. Continue — do not repeat anything.

Generate ONLY sections 10 through 14:

10. Strengths/Challenges/Severity Level — 2-column table. Left column is the domain label, right column contains ALL of the following in one cell: "Strengths:" paragraph, "Challenges:" paragraph, "Severity Level: ☐ Mild ☐ Moderate ☑ Severe". Four rows: Language/Communication, Social Skills, Adaptive/Self-Care, Challenging Behaviors. Do NOT use "Strengths" and "Challenges" as column headers. Do NOT include Vineland scores in this section.

11. Standardized Assessment — Vineland-3. Generate in this EXACT order:
a) Bordered table: header "Standardized Assessment", second row "Name of Standardized Assessment conducted: Vineland Adaptive Behavior Scales, Third Edition (Vineland-3)"
b) Bordered table: header "Vineland Adaptive Behavior Scales, Third Edition (Vineland-3)", second row with the boilerplate intro
c) Single 3-column row: Form: [form name] | Full Name of Rater: [name] | Date: [date]
d) Bordered table cell containing EXACTLY: [INSERT VINELAND ABC/DOMAIN AND SUBDOMAIN SCORE SUMMARY GRAPHIC HERE]
e) Maladaptive Behavior Score Summary table: Type | Scaled Score | Qualitative Descriptor with rows Internalizing, Externalizing, Critical Items
f) Critical Items detail if available
g) Clinical Interpretation paragraph in bordered table

12. Criterion-Referenced Assessment:
a) Header table
b) Boilerplate intro
c) Bordered table cell containing EXACTLY: [INSERT VB-MAPP/ABLLS-R SCORING GRID GRAPHIC HERE]
d) Assessment narrative — all domains in one cell, no bold headings, smooth transitions

13. Goal Objective Summary — write ONLY: [GOAL_SUMMARY_TABLE]

14. Response to Treatment/Authorization Summary — write "N/A — Initial Treatment Plan" for initial plans.

Be thorough. STOP after section 14.`,
  },

  S3A: {
    id: 'S3A',
    label: 'Communication & Social Goals',
    instruction: `Sections 1–14 of the treatment plan have been written above. Continue — do not repeat anything.

Generate ONLY the Language/Communication and Social skill acquisition goals (the first two domains of section 15):

**Language/Communication Goals** (shaded domain header row, then goals)
Write 12–18 goals for this domain.

**Social Goals** (shaded domain header row, then goals)
Write 8–12 goals for this domain.

Start numbering at Goal 1. Use this EXACT format for every goal:
| Medical Necessity Rationale: | Core Deficit of ASD Addressed: A. ... B. ... C. ... |
| [N]. Goal Statement: | (FERB if applicable) When [condition], [client] will [behavior] in [X]% of opportunities across 5 consecutive sessions, in two settings, and in the presence of two people. |
| Baseline: | [descriptive baseline with date] |
| Date of Introduction: | [date] |
| Projected Mastery: | [date ~6 months out] |
| Progress Data: | N/A |

Label goals that serve as functionally equivalent replacement behaviors with (FERB) prefix. FERB goals use 90% mastery criteria. Non-FERB goals use 80% mastery criteria.

MASTERY CRITERIA: FERB goals = 90%. Non-FERB goals = 80%. No exceptions.

Write every goal in full. STOP after the last Social goal. Do NOT write Adaptive goals, BIPs, behavior reduction, or any later sections.`,
  },

  S3B: {
    id: 'S3B',
    label: 'Adaptive/Self-Care Goals',
    instruction: `Sections 1–14 of the treatment plan have been written above. Continue — do not repeat anything.

Generate ONLY the Adaptive/Self-Care skill acquisition goals (section 15, third domain):

**Adaptive/Self-Care Goals** (shaded domain header row, then goals)
Write 5–8 goals for this domain. Start numbering at Goal 25.
Use the same exact goal table format as Communication and Social goals above.
Do NOT include hygiene, dressing, or toileting as skill acquisition goals — instead write those as Caregiver Training goals in a later section.

Label goals that serve as functionally equivalent replacement behaviors with (FERB) prefix. FERB goals use 90% mastery criteria. Non-FERB goals use 80% mastery criteria.

MASTERY CRITERIA: FERB goals = 90%. Non-FERB goals = 80%. No exceptions.

Write every goal completely. STOP after the last Adaptive goal. Do NOT write behavior reduction goals, parent training goals, BIPs, or any later sections.`,
  },

  // S3C instruction is built dynamically at runtime (after S3A+S3B finish) so it can inject
  // the correct starting goal number for Behavior Reduction goals.
  S3C: {
    id: 'S3C',
    label: 'BIPs, Behavior Reduction & Parent Training',
  },

  S3D: {
    id: 'S3D',
    label: 'Generalization, Fading, Crisis & Final Sections',
    instruction: `Sections 1–14 of the treatment plan have been written above. Now generate the final sections.

Generate sections 19 through 26 in order. Do not write skill acquisition goals, behavior reduction, parent training, or BIPs — those are handled separately.

19. Generalization Plan — Bordered table:
    Row 1 (header): "Generalization Protocol"
    Row 2: '[STANDARD_GENERALIZATION_STEPS]'
    Row 3 (header): "Maintenance Protocol"
    Row 4: '[STANDARD_MAINTENANCE_STEPS]'
    Row 5 (data collection): '[DATA_COLLECTION_LANGUAGE]'

20. Transition and Fading Plan:
    - Bordered cell: '[FADING_PLAN_INTRO]'
    - Transition table: Description of Transition | Anticipated Date | Plan (all N/A)
    - Bordered fading rationale: write BOTH paragraphs individualized with actual client name and hours per week from the BCBA notes
    - 4-phase fading table (Phase | Service Levels | Status) — use the exact phase criteria from your instructions, reference specific skill acquisition goal numbers from the BCBA notes
    - Discharge Criteria section whose content cell contains: '[DISCHARGE_CRITERIA]'

21. Crisis Plan:
    - Crisis intro bordered cell
    - Emergency contacts table (Legal Guardian 1, Legal Guardian 2, Emergency Contact 1, Emergency Contact 2, Supervising BCBA, Clinical Director: Teba Aijaz, Central Office: Malka Tyberg, Emergency Services: 911)
    - Crisis protocol bordered cell
    - Individualized crisis protocol table (or "no individualized crisis plan" if client has no significant safety behaviors)
    - Post-Crisis Procedures cell: '[POST_CRISIS_PROCEDURES]'

22. Recommendations for ABA Services:
    - Medical necessity cell: '[MEDICAL_NECESSITY_LANGUAGE]'
    - CPT codes table (CPT Code | Number of Hours Requested | Total Units | Place of Service) — calculate Total Units as hours/week × 26 weeks × 4, show calculation inline; include 97151, 97153, 97155-GT, 97156-GT/U2
    - Anticipated Schedule table reflecting caregiver availability from BCBA notes, matching total hours to requested dosage

23. Provider Information table (Provider Name, Credentials, Signature, Date, NPI). Attestation cell: '[ATTESTATION_LANGUAGE]'. Clinical Reviewer table with signature line.

24. Consent cell: '[CONSENT_LANGUAGE]'. Followed by EXACTLY these three signature lines:
    Client Signature: ______________________________ Date: ______________
    Parent/Caregiver Signature: ____________________ Date: ______________
    Date: ______________

25. Maryland Medicaid Telehealth Readiness Checklist — write only: '[TELEHEALTH_CHECKLIST]'`,
  },
};

// Build the S3C instruction dynamically after S3A+S3B finish, so we can inject
// the correct starting goal number for Behavior Reduction goals.
function buildS3CInstruction(nextGoalNum) {
  return `The skill acquisition goals listed above contain the goal numbers to reference for FERB goals.

Generate sections 16, 17, and 18 in order:

## Section 16: Behavior Intervention Plans

CONCISENESS RULE: Each antecedent and consequence intervention entry must be 2–3 sentences maximum. Bold intervention name + brief clinical description. One blank line between interventions. No explanatory paragraphs.

Write all applicable function-based BIPs. For each BIP that applies, include ALL subsections:
- Date
- Behavior Assessment (ABC)
- Target Behavior (names only — list all topographies for this function)
- Operational Definition (one precise bullet per topography; if not inherently maladaptive, specify maladaptive context)
- Quantitative Baseline Data
- Hypothesized Function
- Functionally Equivalent Replacement Behaviors (reference specific goal numbers from the goal list above)
- Antecedent Interventions (bold sub-header + 2–3 sentences each)
- Consequence Interventions (bold sub-header + 2–3 sentences each; include reinforcement schedule — CRF thinning to VR-2, VR-3, VR-5)
- De-escalation Procedures: write only '[STANDARD_DEESCALATION_PROTOCOL]'

Write BIPs in this order:
1. Social Negative Reinforcement BIP (escape/avoidance). If none: "No Social Negative Reinforcement BIP is indicated for this client."
2. Social Positive Reinforcement BIP (access/attention). If none: "No Social Positive Reinforcement BIP is indicated for this client."
3. Automatic Positive Reinforcement BIP (sensory/automatic). If none: "No Automatic Positive Reinforcement BIP is indicated for this client."

CRITICAL: Every goal labeled (FERB) in the skill acquisition section MUST be referenced in at least one BIP's Functionally Equivalent Replacement Behaviors row. After writing all BIPs, verify that every FERB goal number appears in at least one BIP. If a FERB goal is not referenced, add it to the BIP whose function it replaces.

## Section 17: Behavior Reduction Goals

Start numbering at Goal ${nextGoalNum}. Write one goal per target behavior identified in the BCBA notes using this format:
| Medical Necessity Rationale: | Core Deficit of ASD Addressed: A. ... B. ... |
| [N]. Goal Statement: | When [condition], [client] will reduce instances of [behavior] to [0 or specific number] instances per day across four consecutive weeks in the presence of two people and in two settings. |
| Baseline: | [data] on [date] |
| Date of Introduction: | [date] |
| Projected Mastery: | [date ~6 months out] |
| Progress Data: | N/A |

## Section 18: Parent or Caregiver Training Goals

Continue numbering from the last Behavior Reduction goal. Write at least 2 goals using the standard parent training language from your instructions.

Write every goal completely. STOP after the last Parent Training goal. Do NOT write generalization, fading, or any later sections.`;
}

/**
 * Post-generation mastery criteria enforcer.
 * Scans every Goal Statement line and corrects the "in X% of opportunities"
 * mastery percentage to match FERB status:
 *   - FERB goals  → must be 90%
 *   - Non-FERB    → must be 80%
 * Only the first "in X% of opportunities" on each Goal Statement line is
 * replaced (the mastery criterion); baseline percentages live on separate lines.
 *
 * @param {string} text - Full plan text
 * @returns {{ text: string, ferbFixed: number, nonFerbFixed: number }}
 */
function fixMasteryCriteria(text) {
  let ferbFixed = 0;
  let nonFerbFixed = 0;

  const fixed = text.split('\n').map(line => {
    if (!/Goal Statement/i.test(line)) return line;

    const isFerb = /\(FERB\)/i.test(line);
    const correct = isFerb ? '90' : '80';
    const wrong   = isFerb ? '80' : '90';

    const updated = line.replace(
      new RegExp(`\\bin ${wrong}% of opportunities`, 'i'),
      `in ${correct}% of opportunities`
    );

    if (updated !== line) {
      if (isFerb) ferbFixed++;
      else nonFerbFixed++;
    }
    return updated;
  }).join('\n');

  return { text: fixed, ferbFixed, nonFerbFixed };
}

app.post('/api/generate', authMiddleware, async (req, res) => {
  // Keep-alive ping every 10s so Railway's proxy doesn't close the SSE connection.
  const keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 10000);

  try {
    const { notes, clientInfo, uploadedFileIds } = req.body;
    if (!notes) {
      clearInterval(keepAlive);
      return res.status(400).json({ error: 'Notes are required' });
    }

    const activePrompt = db.prepare('SELECT * FROM prompt_versions WHERE is_active = 1').get();
    const systemPrompt = activePrompt ? activePrompt.text : 'You are an ABA treatment plan generator.';

    let clientName = 'Unknown';
    if (clientInfo?.client_full_name) {
      clientName = clientInfo.client_full_name;
    } else {
      const nameMatch = notes.match(/(?:client(?:'?s)?(?:\s+(?:full\s+)?name)?|child(?:'?s)?(?:\s+name)?)\s*:\s*([^\n,]+)/i);
      if (nameMatch) clientName = nameMatch[1].trim();
    }

    const baseMessage = clientInfo && Object.keys(clientInfo).length > 0
      ? `${formatClientInfoForPrompt(clientInfo)}\n=== ORIGINAL BCBA NOTES ===\n${notes}`
      : notes;

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    if (res.socket) res.socket.setNoDelay(true);
    res.write(': connected\n\n');

    const userId = req.user.id;
    setJob(userId, { status: 'running', section: 1, total: 4, label: GEN.S1.label, planId: null, clientName, error: null, startedAt: Date.now() });

    let clientConnected = true;
    res.on('close', () => { clientConnected = false; });

    let totalChunksSent = 0;
    let totalCharsSent = 0;
    const send = (obj) => {
      if (!clientConnected) return;
      if (obj.type === 'chunk') { totalChunksSent++; totalCharsSent += (obj.text || '').length; }
      try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {}
    };

    let fullPlanText = '';

    console.log("=== STARTING PLAN GENERATION ===");

    const SECTION_TIMEOUT_MS = 5 * 60 * 1000;
    const callWithRetry = async (secId, messages, maxAttempts = 4) => {
      let lastErr;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const msgChars = messages.reduce((sum, m) => sum + (m.content ? m.content.length : 0), 0);
        console.log(`[generate] ${secId} attempt ${attempt}/${maxAttempts}: ${msgChars.toLocaleString()} chars input (~${Math.round(msgChars/4).toLocaleString()} tokens)`);

        let sectionText = '';
        try {
          await new Promise((resolve, reject) => {
            const stream = anthropic.messages.stream({
              model: CLAUDE_MODEL,
              max_tokens: 32768,
              system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
              messages,
            });

            const timeoutId = setTimeout(() => {
              try { stream.abort(); } catch {}
              reject(new Error(`${secId} timed out after 5 minutes — no response from Anthropic API`));
            }, SECTION_TIMEOUT_MS);

            let firstChunk = true;
            stream.on('text', (chunk) => {
              if (firstChunk) { console.log(`[generate] ${secId} first chunk received`); firstChunk = false; }
              sectionText += chunk;
              send({ type: 'chunk', text: chunk });
            });
            stream.on('finalMessage', (msg) => {
              clearTimeout(timeoutId);
              console.log(`[generate] ${secId} done. stop_reason=${msg.stop_reason} output=${sectionText.length} chars`);
              resolve();
            });
            stream.on('error', (err) => { clearTimeout(timeoutId); reject(err); });
          });

          if (sectionText.trim().length < 100) {
            throw new Error(`${secId} returned suspiciously short output (${sectionText.trim().length} chars) — possible empty response`);
          }
          return sectionText;
        } catch (err) {
          lastErr = err;
          const isPrematureClose = err.message === 'Premature close' || err.code === 'ERR_STREAM_PREMATURE_CLOSE';
          const isTimeout = err.message && err.message.includes('timed out after 5 minutes');
          if ((isPrematureClose || isTimeout) && sectionText.length === 0 && attempt < maxAttempts) {
            const delay = attempt * 5000;
            const reason = isTimeout ? 'timeout (no response)' : 'premature close (no output)';
            console.log(`[generate] ${secId} ${reason}. Retrying in ${delay/1000}s (attempt ${attempt+1}/${maxAttempts})...`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          console.error(`[generate] ${secId} failed on attempt ${attempt}:`, err.message);
          throw err;
        }
      }
      throw lastErr;
    };

    const GOAL_RE = /(\d+)\.\s+(?:\(FERB\)\s+)?Goal Statement:\**\s*\|?\s*(.+?)(?:\s*\|)?\s*$/i;
    const extractGoalNumbers = (s3aText, s3bText) => {
      const lines = [];
      for (const line of (s3aText + '\n' + s3bText).split('\n')) {
        const m = line.match(GOAL_RE);
        if (m) lines.push(`${m[1]}. Goal Statement: ${m[2].trim()}`);
      }
      console.log(`[generate] Extracted ${lines.length} goal statements for BIP context`);
      return lines.join('\n');
    };

    const extractHighestGoalNum = (text) => {
      let highest = 0;
      for (const line of text.split('\n')) {
        const m = line.match(/(\d+)\.\s+(?:\(FERB\)\s+)?Goal Statement/i);
        if (m) highest = Math.max(highest, parseInt(m[1], 10));
      }
      return highest;
    };

    const buildMessages = (sec, contextBlock) => {
      const clientPrefix = `You are generating a treatment plan for ${clientName}. Use ONLY "${clientName}" as the client's name throughout — do not use any other client's name.\n\n`;
      const instruction = clientPrefix + sec.instruction;
      return contextBlock
        ? [
            { role: 'user', content: baseMessage },
            { role: 'assistant', content: contextBlock },
            { role: 'user', content: instruction },
          ]
        : [{ role: 'user', content: `${baseMessage}\n\n${instruction}` }];
    };

    send({ type: 'progress', section: 1, total: 4, label: GEN.S1.label });
    setJob(userId, { section: 1, label: GEN.S1.label });
    const s1Text = await callWithRetry(GEN.S1.id, buildMessages(GEN.S1, null));

    send({ type: 'progress', section: 2, total: 4, label: GEN.S2.label });
    setJob(userId, { section: 2, label: GEN.S2.label });
    const s2Text = await callWithRetry(GEN.S2.id, buildMessages(GEN.S2, s1Text));

    const s1s2Context = s1Text + '\n\n' + s2Text;

    send({ type: 'progress', section: 3, total: 4, label: 'Skill Acquisition Goals (parallel)' });
    setJob(userId, { section: 3, label: 'Skill Acquisition Goals (parallel)' });
    console.log('[generate] Starting S3A and S3B in parallel');
    const [s3aText, s3bText] = await Promise.all([
      callWithRetry(GEN.S3A.id, buildMessages(GEN.S3A, s1s2Context)),
      callWithRetry(GEN.S3B.id, buildMessages(GEN.S3B, s1s2Context)),
    ]);
    console.log(`[generate] S3A+S3B complete. S3A=${s3aText.length} chars, S3B=${s3bText.length} chars`);

    const goalList = extractGoalNumbers(s3aText, s3bText);
    const highestSkillGoalNum = extractHighestGoalNum(s3aText + '\n' + s3bText);
    const nextGoalNum = highestSkillGoalNum + 1;
    console.log(`[generate] Highest skill acquisition goal: ${highestSkillGoalNum} → Behavior Reduction starts at ${nextGoalNum}`);

    send({ type: 'progress', section: 4, total: 4, label: 'BIPs & Final Sections (parallel)' });
    setJob(userId, { section: 4, label: 'BIPs & Final Sections (parallel)' });
    console.log('[generate] Starting S3C and S3D in parallel');
    const bipContext = s1s2Context + (goalList
      ? '\n\n=== SKILL ACQUISITION GOALS (reference these numbers for FERB goals) ===\n' + goalList
      : '');
    const s3cSec = { id: GEN.S3C.id, instruction: buildS3CInstruction(nextGoalNum) };
    const [s3cText, s3dText] = await Promise.all([
      callWithRetry(s3cSec.id, buildMessages(s3cSec, bipContext)),
      callWithRetry(GEN.S3D.id, buildMessages(GEN.S3D, s1s2Context)),
    ]);
    console.log(`[generate] S3C+S3D complete. S3C=${s3cText.length} chars, S3D=${s3dText.length} chars`);

    const GOAL_LINE_RE = /\d+\.\s+(?:\(FERB\)\s+)?Goal Statement/i;
    const goalCount = (s3aText + '\n' + s3bText + '\n' + s3cText)
      .split('\n').filter(line => GOAL_LINE_RE.test(line)).length;
    console.log(`[generate] Goal count for summary table: ${goalCount}`);
    const debugLines = (s3aText + '\n' + s3bText + '\n' + s3cText).split('\n').filter(l => /Goal Statement/i.test(l)).slice(0, 10);
    console.log('[generate] GOAL DEBUG: First 10 goal lines found in s3a+s3b+s3c:');
    debugLines.forEach(l => console.log('  ', l.slice(0, 120)));

    fullPlanText = [s1Text, s2Text, s3aText, s3bText, s3cText, s3dText].filter(Boolean).join('\n\n');
    console.log(`[generate] All sections complete. Total: ${fullPlanText.length} chars (${fullPlanText.split('\n').length} lines)`);
    console.log(`[generate] SSE chunks sent: ${totalChunksSent}, total chars streamed: ${totalCharsSent}`);

    clearInterval(keepAlive);

    fullPlanText = stripAIPreamble(fullPlanText);

    const { text: planTextFixed, ferbFixed, nonFerbFixed } = fixMasteryCriteria(fullPlanText);
    fullPlanText = planTextFixed;
    console.log(`[generate] Mastery criteria: ${ferbFixed} FERB goals fixed to 90%, ${nonFerbFixed} non-FERB goals fixed to 80%`);

    const planNameMatch = fullPlanText.match(/Participant Name[:\s]+([^\n\r]+)/i);
    if (planNameMatch && clientName === 'Unknown') clientName = planNameMatch[1].trim();

    const bcbaMatch = fullPlanText.match(/(?:Supervising BCBA|BCBA Name)[:\s|]+([^\n\r|]+)/i);
    const bcbaName = bcbaMatch ? bcbaMatch[1].trim() : '[BCBA NAME]';
    const dateMatch = fullPlanText.match(/Assessment Date[:\s|]+([^\n\r|]+)/i);
    const assessmentDate = dateMatch ? dateMatch[1].trim() : '[DATE]';

    const correctGoalTable = buildGoalSummaryTable(goalCount);
    fullPlanText = fullPlanText.replace(
      /(##\s+Goal Objective Summary\s*\n)([\s\S]*?)(?=##\s+Response to Treatment)/i,
      (match, header) => header + '\n' + correctGoalTable + '\n\n'
    );
    fullPlanText = fullPlanText.replace(
      /(Total\s*#?\s*(?:of\s*)?(?:new\s*)?[Gg]oals[:\s|*]+)\d+/g,
      (match, prefix) => prefix + goalCount
    );

    const injectedPlanText = injectBoilerplate(fullPlanText, clientName, bcbaName, assessmentDate, goalCount);
    console.log(`[generate] Boilerplate injected. Raw: ${fullPlanText.length} chars → Final: ${injectedPlanText.length} chars`);

    console.log(`[generate] Saving to DB: ${injectedPlanText.length} chars for plan "${clientName}"`);
    const planInsert = db.prepare(
      'INSERT INTO plan_history (user_id, client_name, original_notes) VALUES (?, ?, ?)'
    ).run(req.user.id, clientName, notes);
    const planId = planInsert.lastInsertRowid;

    db.prepare(
      'INSERT INTO plan_revisions (plan_id, revision_number, text, feedback) VALUES (?, ?, ?, ?)'
    ).run(planId, 0, injectedPlanText, 'Initial generation');
    console.log(`[generate] DB save complete. plan_id=${planId}, revision_number=0, text_length=${injectedPlanText.length}`);

    if (clientInfo && Object.keys(clientInfo).length > 0) {
      db.prepare('INSERT OR REPLACE INTO client_info (plan_id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
        .run(planId, JSON.stringify(clientInfo));
    }

    if (Array.isArray(uploadedFileIds) && uploadedFileIds.length > 0) {
      const clientDir = path.join(UPLOADS_DIR, 'clients', String(planId));
      fs.mkdirSync(clientDir, { recursive: true });
      for (const f of uploadedFileIds) {
        try {
          const tempFiles = fs.readdirSync(TEMP_UPLOADS_DIR).filter(n => n.startsWith(f.fileId + '_'));
          if (tempFiles.length === 0) continue;
          const tempFilename = tempFiles[0];
          const destFilename = `${Date.now()}_${tempFilename.slice(f.fileId.length + 1)}`;
          fs.renameSync(
            path.join(TEMP_UPLOADS_DIR, tempFilename),
            path.join(clientDir, destFilename)
          );
          const ext = path.extname(f.originalName).toLowerCase();
          db.prepare(
            'INSERT INTO client_documents (plan_id, filename, original_name, file_type, file_size, uploaded_by) VALUES (?,?,?,?,?,?)'
          ).run(planId, destFilename, f.originalName, ext || f.fileType, f.fileSize || 0, req.user.id);
        } catch (e) {
          console.error(`[generate] Failed to save temp file ${f.fileId}:`, e.message);
        }
      }
    }

    if (clientConnected) {
      send({ type: 'done', plan_id: planId, client_name: clientName });
      res.end();
    }
    setJob(userId, { status: 'done', planId, clientName });
    setTimeout(() => { if (generationJobs.get(userId)?.status === 'done') clearJob(userId); }, 60000);
    logActivity(req.user.id, req.user.username, 'generated_plan', 'plan', planId, clientName);

    setImmediate(async () => {
      try {
        const clarifyMsg = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: `You are an ABA treatment plan assistant. A complete treatment plan was just generated from the BCBA notes below. Any missing information was filled with bracketed placeholders like [PHONE NUMBER] or [TO BE DETERMINED].\n\nReview the notes and identify what specific information is missing or unclear that would improve the plan. Ask targeted clarifying questions in a friendly, clinical tone — 3 to 7 questions max. Be specific (e.g., "What is the 97153 hours per week you want to request?" not "Are there any missing hours?"). Do not ask about things that are clearly present in the notes.\n\nBCBA Notes:\n${notes.slice(0, 8000)}`
          }]
        });
        const clarifyText = clarifyMsg.content[0].text;
        db.prepare('INSERT INTO chat_messages (plan_id, role, content, username) VALUES (?, ?, ?, ?)').run(planId, 'assistant', clarifyText, 'Claude');
        console.log(`[generate] Posted clarifying questions to chat for plan_id=${planId}`);
      } catch (e) {
        console.log('[generate] Could not generate clarifying questions:', e.message);
      }
    });

  } catch (err) {
    clearInterval(keepAlive);
    console.error('Generate error:', err);
    if (req.user) setJob(req.user.id, { status: 'error', error: err.message });
    setTimeout(() => { if (req.user && generationJobs.get(req.user.id)?.status === 'error') clearJob(req.user.id); }, 30000);
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
      res.end();
    } catch {}
  }
});

// ---- REVISE ROUTE ----

app.post('/api/revise', authMiddleware, async (req, res) => {
  try {
    const { plan_id, feedback } = req.body;
    if (!plan_id || !feedback) return res.status(400).json({ error: 'plan_id and feedback are required' });

    const plan = db.prepare('SELECT * FROM plan_history WHERE id = ?').get(plan_id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const allRevisions = db.prepare(
      'SELECT * FROM plan_revisions WHERE plan_id = ? ORDER BY revision_number ASC'
    ).all(plan_id);
    if (!allRevisions.length) return res.status(404).json({ error: 'No revisions found' });

    const activePrompt = db.prepare('SELECT * FROM prompt_versions WHERE is_active = 1').get();
    const systemPrompt = activePrompt ? activePrompt.text : 'You are an ABA treatment plan generator.';

    // Client name comes from plan_history — use it to anchor every revision so the
    // AI never substitutes a hallucinated or bleed-over name from the plan body text.
    const clientName = plan.client_name || 'the client';

    const messages = [
      { role: 'user', content: plan.original_notes },
      { role: 'assistant', content: allRevisions[0].text },
    ];
    for (let i = 1; i < allRevisions.length; i++) {
      messages.push({ role: 'user', content: allRevisions[i].feedback });
      messages.push({ role: 'assistant', content: allRevisions[i].text });
    }
    messages.push({
      role: 'user',
      content: `You are revising a treatment plan for ${clientName}. Use ONLY "${clientName}" as the client's name throughout — do not use any other client's name.\n\n${feedback}\n\nIMPORTANT: Return the COMPLETE, full treatment plan with this change incorporated. Do not leave any section blank, do not use placeholders, and do not skip any section — output the entire plan from beginning to end with all original sections fully written out and only the requested change made.`,
    });

    // Stream the response to prevent Railway's request timeout from cutting off long generations
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    if (res.socket) res.socket.setNoDelay(true);
    res.write(': connected\n\n');

    let clientConnected = true;
    let keepAlive;
    res.on('close', () => { clientConnected = false; clearInterval(keepAlive); });

    const send = (obj) => {
      if (!clientConnected) return;
      try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {}
    };

    let revisedText = '';
    const msgChars = messages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0);
    console.log(`[revise] plan_id=${plan_id} input: ${msgChars.toLocaleString()} chars (~${Math.round(msgChars/4).toLocaleString()} tokens)`);

    const stream = anthropic.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 32768,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages,
    });

    keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20000);

    stream.on('text', (chunk) => {
      revisedText += chunk;
      send({ type: 'chunk', text: chunk });
    });

    stream.on('finalMessage', async (msg) => {
      clearInterval(keepAlive);
      const newRevisionNumber = allRevisions[allRevisions.length - 1].revision_number + 1;
      revisedText = stripAIPreamble(revisedText);

      // Enforce mastery criteria (FERB=90%, non-FERB=80%)
      const { text: fixedText, ferbFixed, nonFerbFixed } = fixMasteryCriteria(revisedText);
      revisedText = fixedText;
      if (ferbFixed + nonFerbFixed > 0) {
        console.log(`[revise] Mastery criteria: ${ferbFixed} FERB goals fixed to 90%, ${nonFerbFixed} non-FERB goals fixed to 80%`);
      }

      // Recalculate goal count and update summary table + total line
      const GOAL_LINE_RE = /\d+\.\s+(?:\(FERB\)\s+)?Goal Statement/i;
      const goalCount = revisedText.split('\n').filter(line => GOAL_LINE_RE.test(line)).length;
      if (goalCount > 0) {
        const correctGoalTable = buildGoalSummaryTable(goalCount);
        revisedText = revisedText.replace(
          /(##\s+Goal Objective Summary\s*\n)([\s\S]*?)(?=##\s+Response to Treatment)/i,
          (match, header) => header + '\n' + correctGoalTable + '\n\n'
        );
        revisedText = revisedText.replace(
          /(Total\s*#?\s*(?:of\s*)?(?:new\s*)?[Gg]oals[:\s|*]+)\d+/g,
          (match, prefix) => prefix + goalCount
        );
      }

      console.log(`[revise] done. stop_reason=${msg.stop_reason} output=${revisedText.length.toLocaleString()} chars (${revisedText.split('\n').length} lines) goals=${goalCount}`);
      db.prepare(
        'INSERT INTO plan_revisions (plan_id, revision_number, text, feedback) VALUES (?, ?, ?, ?)'
      ).run(plan_id, newRevisionNumber, revisedText, feedback);
      console.log(`[revise] saved revision ${newRevisionNumber} for plan_id=${plan_id}`);
      logActivity(req.user.id, req.user.username, 'revised_plan', 'plan', Number(plan_id), feedback.slice(0, 200));
      if (clientConnected) {
        send({ type: 'done', revision_number: newRevisionNumber });
        res.end();
      }
    });

    stream.on('error', (err) => {
      clearInterval(keepAlive);
      console.error('Revise stream error:', err);
      if (clientConnected) {
        send({ type: 'error', error: err.message });
        res.end();
      }
    });

  } catch (err) {
    console.error('Revise error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- GET REVISIONS ----

app.get('/api/plan/:id/revisions', authMiddleware, (req, res) => {
  try {
    const revisions = db.prepare(
      'SELECT * FROM plan_revisions WHERE plan_id = ? ORDER BY revision_number ASC'
    ).all(req.params.id);
    res.json(revisions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- PLAN HISTORY LIST ----

app.get('/api/plans', authMiddleware, (req, res) => {
  try {
    const plans = db.prepare(`
      SELECT
        ph.id,
        ph.client_name,
        ph.created_at,
        u.username AS bcba,
        COUNT(pr.id) AS revision_count
      FROM plan_history ph
      LEFT JOIN users u ON ph.user_id = u.id
      LEFT JOIN plan_revisions pr ON pr.plan_id = ph.id
      GROUP BY ph.id
      ORDER BY ph.created_at DESC
    `).all();
    res.json(plans);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- GET SINGLE PLAN (latest revision text + notes) ----

app.get('/api/plans/:id', authMiddleware, (req, res) => {
  try {
    const plan = db.prepare('SELECT * FROM plan_history WHERE id = ?').get(req.params.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const revisions = db.prepare(
      'SELECT * FROM plan_revisions WHERE plan_id = ? ORDER BY revision_number ASC'
    ).all(req.params.id);
    res.json({ ...plan, revisions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- DUPLICATE PLAN ----

app.post('/api/plans/:id/duplicate', authMiddleware, async (req, res) => {
  try {
    const original = db.prepare('SELECT * FROM plan_history WHERE id = ?').get(req.params.id);
    if (!original) return res.status(404).json({ error: 'Plan not found' });

    const latestRevision = db.prepare(
      'SELECT * FROM plan_revisions WHERE plan_id = ? ORDER BY revision_number DESC LIMIT 1'
    ).get(req.params.id);

    const newPlan = db.prepare(
      'INSERT INTO plan_history (user_id, client_name, original_notes) VALUES (?, ?, ?)'
    ).run(req.user.id, `${original.client_name} (Copy)`, original.original_notes);

    const newPlanId = newPlan.lastInsertRowid;

    if (latestRevision) {
      db.prepare(
        'INSERT INTO plan_revisions (plan_id, revision_number, text, feedback) VALUES (?, ?, ?, ?)'
      ).run(newPlanId, 0, latestRevision.text, 'Duplicated from plan #' + original.id);
    }

    logActivity(req.user.id, req.user.username, 'duplicated_plan', 'plan', newPlanId, `original plan ${req.params.id}`);
    res.json({ plan_id: newPlanId, client_name: `${original.client_name} (Copy)` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- FILE UPLOAD ----

app.post('/api/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { originalname, buffer, mimetype } = req.file;
    const ext = path.extname(originalname).toLowerCase();
    let extractedText = '';

    // Detect actual file type from magic bytes (ignore extension)
    const isPDF = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46; // %PDF
    const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B; // PK header (docx/zip)

    if (isPDF) {
      const data = await pdfParse(buffer);
      extractedText = data.text;
    } else if (ext === '.docx' || (isZip && ext !== '.zip' && ext !== '.xlsx')) {
      const result = await mammoth.extractRawText({ buffer });
      extractedText = result.value;
    } else if (['.xlsx', '.xls'].includes(ext)) {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const parts = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
        if (csv.trim()) parts.push(`--- Sheet: ${sheetName} ---\n${csv}`);
      }
      extractedText = parts.join('\n\n');
    } else if (['.txt', '.md', '.rtf'].includes(ext)) {
      extractedText = buffer.toString('utf8');
    } else if (ext === '.zip') {
      // Write to temp file first — adm-zip is more reliable reading from disk
      const tmpPath = path.join(os.tmpdir(), `upload_${Date.now()}.zip`);
      fs.writeFileSync(tmpPath, buffer);
      let zip;
      try {
        zip = new AdmZip(tmpPath);
      } finally {
        try { fs.unlinkSync(tmpPath); } catch {}
      }
      const entries = zip.getEntries();
      const parts = [];
      for (const entry of entries) {
        if (entry.isDirectory) continue;
        const entryName = entry.entryName;
        const entryExt = path.extname(entryName).toLowerCase();
        const entryBuffer = entry.getData();
        let entryText = '';
        try {
          if (entryExt === '.pdf') {
            const data = await pdfParse(entryBuffer);
            entryText = data.text;
          } else if (entryExt === '.docx') {
            const result = await mammoth.extractRawText({ buffer: entryBuffer });
            entryText = result.value;
          } else if (['.txt', '.md', '.rtf'].includes(entryExt)) {
            entryText = entryBuffer.toString('utf8');
          }
        } catch (e) {
          entryText = `[Could not parse ${entryName}]`;
        }
        if (entryText) {
          parts.push(`--- File: ${entryName} ---\n${entryText}`);
        }
      }
      extractedText = parts.join('\n\n');
    } else {
      return res.status(400).json({ error: 'Unsupported file type' });
    }

    // Save file to temp dir so it can be attached to the client record after generation
    const fileId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const safeName = originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const tempFilename = `${fileId}_${safeName}`;
    fs.writeFileSync(path.join(TEMP_UPLOADS_DIR, tempFilename), buffer);

    res.json({ text: extractedText, fileId, originalName: originalname, fileSize: buffer.length, fileType: ext || mimetype });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- PROMPT ROUTES ----

app.get('/api/prompt', authMiddleware, (req, res) => {
  try {
    const prompt = db.prepare('SELECT * FROM prompt_versions WHERE is_active = 1').get();
    if (!prompt) return res.status(404).json({ error: 'No active prompt found' });
    res.json(prompt);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/prompt', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { text, label } = req.body;
    if (!text || !label) return res.status(400).json({ error: 'text and label are required' });

    db.prepare('UPDATE prompt_versions SET is_active = 0').run();
    const result = db.prepare(
      'INSERT INTO prompt_versions (text, label, is_active) VALUES (?, ?, 1)'
    ).run(text, label);

    const newPrompt = db.prepare('SELECT * FROM prompt_versions WHERE id = ?').get(result.lastInsertRowid);
    logActivity(req.user.id, req.user.username, 'edited_prompt', 'prompt', newPrompt.id, label);
    res.json(newPrompt);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/prompt/history', authMiddleware, (req, res) => {
  try {
    const versions = db.prepare('SELECT * FROM prompt_versions ORDER BY created_at DESC').all();
    res.json(versions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/prompt/restore/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const prompt = db.prepare('SELECT * FROM prompt_versions WHERE id = ?').get(id);
    if (!prompt) return res.status(404).json({ error: 'Prompt version not found' });

    db.prepare('UPDATE prompt_versions SET is_active = 0').run();
    db.prepare('UPDATE prompt_versions SET is_active = 1 WHERE id = ?').run(id);
    logActivity(req.user.id, req.user.username, 'restored_prompt', 'prompt', Number(id), `version ${id}`);
    res.json({ message: 'Prompt restored', id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- USER ROUTES ----

app.get('/api/users', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const users = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY created_at ASC').all();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password || !role) {
      return res.status(400).json({ error: 'username, password, and role are required' });
    }
    if (!['Admin', 'BCBA'].includes(role)) {
      return res.status(400).json({ error: 'Role must be Admin or BCBA' });
    }
    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (exists) return res.status(409).json({ error: 'Username already exists' });

    const hash = await bcrypt.hash(password, 10);
    const result = db.prepare(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
    ).run(username, hash, role);

    const newUser = db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);
    logActivity(req.user.id, req.user.username, 'created_user', 'user', newUser.id, username);
    res.status(201).json(newUser);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    logActivity(req.user.id, req.user.username, 'deleted_user', 'user', Number(id), user.username);
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- LOGO ROUTES ----

const LOGO_PATH = path.join(DATA_DIR, 'company-logo.png');

// POST /api/settings/logo — upload / replace logo (auth required)
app.post('/api/settings/logo', authMiddleware, uploadLogo.single('logo'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    fs.writeFileSync(LOGO_PATH, req.file.buffer);
    logActivity(req.user.id, req.user.username, 'uploaded_logo', 'settings', null, null);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/logo — serve the logo (no auth required)
app.get('/api/settings/logo', (req, res) => {
  if (!fs.existsSync(LOGO_PATH)) return res.status(404).json({ error: 'No logo uploaded' });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(LOGO_PATH);
});

// DELETE /api/settings/logo — remove the logo (auth + admin required)
app.delete('/api/settings/logo', authMiddleware, adminMiddleware, (req, res) => {
  try {
    if (fs.existsSync(LOGO_PATH)) fs.unlinkSync(LOGO_PATH);
    logActivity(req.user.id, req.user.username, 'deleted_logo', 'settings', null, null);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- EXPORT ROUTE ----

app.get('/api/export/:plan_id/:revision_number', authMiddleware, async (req, res) => {
  try {
    const { plan_id, revision_number } = req.params;
    const plan = db.prepare('SELECT * FROM plan_history WHERE id = ?').get(plan_id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const revision = db.prepare(
      'SELECT * FROM plan_revisions WHERE plan_id = ? AND revision_number = ?'
    ).get(plan_id, revision_number);
    if (!revision) return res.status(404).json({ error: 'Revision not found' });

    console.log(`[export] plan_id=${plan_id} rev=${revision_number} text_length=${revision.text.length} chars (${revision.text.split('\n').length} lines)`);
    const logoBuffer = fs.existsSync(LOGO_PATH) ? fs.readFileSync(LOGO_PATH) : null;
    const doc = buildDocx(revision.text, plan.client_name, logoBuffer);
    const buffer = await Packer.toBuffer(doc);
    console.log(`[export] docx buffer size: ${buffer.length} bytes`);
    const safeName = (plan.client_name || 'treatment-plan').replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-');
    const filename = `treatment-plan-${safeName}-rev${revision_number}.docx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    logActivity(req.user.id, req.user.username, 'exported_plan', 'plan', Number(plan_id), `revision ${revision_number}`);
    res.send(buffer);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- CLIENT RECORDS ROUTES ----

// Client document disk storage
const clientStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOADS_DIR, 'clients', req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
  }
});
const uploadClient = multer({ storage: clientStorage });

// GET /api/clients — list all clients
app.get('/api/clients', authMiddleware, (req, res) => {
  try {
    const clients = db.prepare(`
      SELECT ph.id, ph.client_name, ph.created_at, ph.status, ph.notes,
        u.username AS bcba,
        COUNT(DISTINCT pr.id) AS revision_count,
        MAX(pr.created_at) AS last_modified
      FROM plan_history ph
      LEFT JOIN users u ON ph.user_id = u.id
      LEFT JOIN plan_revisions pr ON pr.plan_id = ph.id
      GROUP BY ph.id
      ORDER BY ph.created_at DESC
    `).all();
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/clients/:id — single client with revisions and documents
app.get('/api/clients/:id', authMiddleware, (req, res) => {
  try {
    const client = db.prepare(`SELECT ph.*, u.username AS bcba FROM plan_history ph LEFT JOIN users u ON ph.user_id=u.id WHERE ph.id=?`).get(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const revisions = db.prepare('SELECT * FROM plan_revisions WHERE plan_id=? ORDER BY revision_number ASC').all(req.params.id);
    const documents = db.prepare(`SELECT cd.*, u.username AS uploader FROM client_documents cd LEFT JOIN users u ON cd.uploaded_by=u.id WHERE cd.plan_id=? ORDER BY cd.uploaded_at DESC`).all(req.params.id);
    res.json({ ...client, revisions, documents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/clients/:id/status
app.put('/api/clients/:id/status', authMiddleware, (req, res) => {
  try {
    db.prepare('UPDATE plan_history SET status=? WHERE id=?').run(req.body.status, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/clients/:id/notes
app.put('/api/clients/:id/notes', authMiddleware, (req, res) => {
  try {
    db.prepare('UPDATE plan_history SET notes=? WHERE id=?').run(req.body.notes, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/clients/:id
app.delete('/api/clients/:id', authMiddleware, (req, res) => {
  try {
    const planRecord = db.prepare('SELECT client_name FROM plan_history WHERE id=?').get(req.params.id);
    const uploadDir = path.join(UPLOADS_DIR, 'clients', req.params.id);
    if (fs.existsSync(uploadDir)) fs.rmSync(uploadDir, { recursive: true, force: true });
    db.prepare('DELETE FROM client_documents WHERE plan_id=?').run(req.params.id);
    db.prepare('DELETE FROM plan_revisions WHERE plan_id=?').run(req.params.id);
    db.prepare('DELETE FROM plan_history WHERE id=?').run(req.params.id);
    logActivity(req.user.id, req.user.username, 'deleted_plan', 'plan', Number(req.params.id), planRecord?.client_name || null);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- AUTHORIZATION PERIOD ROUTES ----

// GET /api/clients/:id/auth-periods
app.get('/api/clients/:id/auth-periods', authMiddleware, (req, res) => {
  try {
    const periods = db.prepare(
      'SELECT * FROM authorization_periods WHERE plan_id=? ORDER BY period_number ASC'
    ).all(req.params.id);
    res.json(periods);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/clients/:id/auth-periods
app.post('/api/clients/:id/auth-periods', authMiddleware, (req, res) => {
  try {
    const { start_date, end_date, status = 'active' } = req.body;
    const existing = db.prepare(
      'SELECT COUNT(*) AS cnt FROM authorization_periods WHERE plan_id=?'
    ).get(req.params.id);
    const period_number = existing.cnt + 1;
    const period_type = period_number === 1 ? 'initial' : 'reauth';
    const result = db.prepare(
      'INSERT INTO authorization_periods (plan_id, period_number, period_type, start_date, end_date, status) VALUES (?,?,?,?,?,?)'
    ).run(req.params.id, period_number, period_type, start_date || null, end_date || null, status);
    const period = db.prepare('SELECT * FROM authorization_periods WHERE id=?').get(result.lastInsertRowid);
    res.json(period);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/clients/:id/auth-periods/:period_id
app.put('/api/clients/:id/auth-periods/:period_id', authMiddleware, (req, res) => {
  try {
    const { start_date, end_date, status } = req.body;
    db.prepare(
      'UPDATE authorization_periods SET start_date=COALESCE(?,start_date), end_date=COALESCE(?,end_date), status=COALESCE(?,status) WHERE id=? AND plan_id=?'
    ).run(start_date ?? null, end_date ?? null, status ?? null, req.params.period_id, req.params.id);
    const period = db.prepare('SELECT * FROM authorization_periods WHERE id=?').get(req.params.period_id);
    res.json(period);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/clients/:id/auth-periods/:period_id/start-reauth
app.post('/api/clients/:id/auth-periods/:period_id/start-reauth', authMiddleware, async (req, res) => {
  try {
    const planId = req.params.id;
    const periodId = req.params.period_id;

    // Validate the period
    const period = db.prepare('SELECT * FROM authorization_periods WHERE id=? AND plan_id=?').get(periodId, planId);
    if (!period) return res.status(404).json({ error: 'Period not found' });
    if (period.period_type !== 'reauth') return res.status(400).json({ error: 'This period is not a reauth period' });
    if (period.status !== 'active') return res.status(400).json({ error: 'Period is not active' });

    // Get client info from plan_history
    const plan = db.prepare('SELECT * FROM plan_history WHERE id=?').get(planId);
    if (!plan) return res.status(404).json({ error: 'Client plan not found' });

    // Get previous plan's latest revision
    const latestRevision = db.prepare(
      'SELECT * FROM plan_revisions WHERE plan_id=? ORDER BY revision_number DESC LIMIT 1'
    ).get(planId);
    const previousPlanText = latestRevision ? latestRevision.text : '';

    // Extract goals from previous plan using the same regex as generate route
    const goalLines = previousPlanText.split('\n')
      .filter(line => /^\s*\d+\.\s+\**(?:\(FERB\)\s+)?\**Goal Statement:/i.test(line));
    const goalCount = goalLines.length;
    const goalSummary = goalLines.length > 0
      ? goalLines.join('\n')
      : 'No goals found in previous plan.';

    // Get documents tagged to this reauth period
    const periodDocs = db.prepare(
      'SELECT * FROM client_documents WHERE plan_id=? AND authorization_period_id=?'
    ).all(planId, periodId);

    // Extract text from each document
    const docTexts = [];
    for (const doc of periodDocs) {
      try {
        const filePath = path.join(UPLOADS_DIR, 'clients', planId, doc.filename);
        const buffer = fs.readFileSync(filePath);
        const ext = path.extname(doc.original_name).toLowerCase();
        const isPDF = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
        let text = '';
        if (isPDF) { const data = await pdfParse(buffer); text = data.text; }
        else if (ext === '.docx') { const r = await mammoth.extractRawText({ buffer }); text = r.value; }
        else { text = buffer.toString('utf8'); }
        docTexts.push(`--- ${doc.original_name} ---\n${text.trim()}`);
      } catch (e) {
        docTexts.push(`--- ${doc.original_name} --- [Error extracting: ${e.message}]`);
      }
    }

    // Build the reauth context stored as original_notes
    const reauthContext = [
      `=== PREVIOUS TREATMENT PLAN GOALS (${goalCount} goal${goalCount !== 1 ? 's' : ''}) ===`,
      goalSummary,
      '',
      `=== NEW ASSESSMENT DOCUMENTS (${docTexts.length} file${docTexts.length !== 1 ? 's' : ''}) ===`,
      docTexts.length > 0 ? docTexts.join('\n\n') : 'No documents uploaded for this reauth period.',
    ].join('\n');

    // Create a new plan_history entry for this reauth session
    const insertResult = db.prepare(
      'INSERT INTO plan_history (user_id, client_name, original_notes, plan_type) VALUES (?, ?, ?, ?)'
    ).run(req.user.id, plan.client_name, reauthContext, 'reauth');
    const reauthPlanId = insertResult.lastInsertRowid;

    // Save the previous plan as revision 0 so ReviewRevise has content to display
    db.prepare(
      'INSERT INTO plan_revisions (plan_id, revision_number, text, feedback) VALUES (?, ?, ?, ?)'
    ).run(
      reauthPlanId,
      0,
      previousPlanText || '# Reauth Plan\n\nUse the chat to generate the reauthorization treatment plan.',
      'Previous plan reference'
    );

    // Seed the chat with a pre-loaded assistant greeting
    const greeting = `I've reviewed the previous treatment plan for **${plan.client_name}** and the reauth documents.\n\n` +
      `**Summary:**\n` +
      `- ${goalCount} goal${goalCount !== 1 ? 's' : ''} from the previous authorization period\n` +
      `- ${docTexts.length} new assessment document${docTexts.length !== 1 ? 's' : ''} (${periodDocs.map(d => d.original_name).join(', ') || 'none'})\n\n` +
      `I can help you:\n` +
      `1. Analyze each previous goal (Mastered / Partially Met / Not Met) based on the new data\n` +
      `2. Write a Response to Treatment and Authorization Summary\n` +
      `3. Recommend which goals to continue, modify, or discontinue\n` +
      `4. Propose new goals based on the updated assessment scores\n` +
      `5. Generate the complete reauth treatment plan when ready\n\n` +
      `What would you like to start with?`;

    db.prepare('INSERT INTO chat_messages (plan_id, role, content, username) VALUES (?, ?, ?, ?)')
      .run(reauthPlanId, 'assistant', greeting, 'Claude');

    logActivity(req.user.id, req.user.username, 'started_reauth', 'plan', Number(reauthPlanId), plan.client_name);
    console.log(`[reauth] Created reauth plan_id=${reauthPlanId} for client "${plan.client_name}", period_id=${periodId}, ${goalCount} goals, ${docTexts.length} docs`);

    res.json({ plan_id: reauthPlanId, client_name: plan.client_name });
  } catch (err) {
    console.error('Start reauth error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/clients/:id/documents — upload a document
app.post('/api/clients/:id/documents', authMiddleware, uploadClient.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { originalname, filename, mimetype, size } = req.file;
    const ext = path.extname(originalname).toLowerCase();
    const periodId = req.body.authorization_period_id ? Number(req.body.authorization_period_id) : null;
    const result = db.prepare(
      'INSERT INTO client_documents (plan_id, filename, original_name, file_type, file_size, uploaded_by, authorization_period_id) VALUES (?,?,?,?,?,?,?)'
    ).run(req.params.id, filename, originalname, ext || mimetype, size, req.user.id, periodId);
    const doc = db.prepare('SELECT cd.*, u.username AS uploader FROM client_documents cd LEFT JOIN users u ON cd.uploaded_by=u.id WHERE cd.id=?').get(result.lastInsertRowid);
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/clients/:id/documents — list documents, optionally filtered by period
app.get('/api/clients/:id/documents', authMiddleware, (req, res) => {
  try {
    let docs;
    if (req.query.period_id) {
      docs = db.prepare(`SELECT cd.*, u.username AS uploader FROM client_documents cd LEFT JOIN users u ON cd.uploaded_by=u.id WHERE cd.plan_id=? AND cd.authorization_period_id=? ORDER BY cd.uploaded_at DESC`).all(req.params.id, req.query.period_id);
    } else {
      docs = db.prepare(`SELECT cd.*, u.username AS uploader FROM client_documents cd LEFT JOIN users u ON cd.uploaded_by=u.id WHERE cd.plan_id=? ORDER BY cd.uploaded_at DESC`).all(req.params.id);
    }
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/clients/:id/documents/:doc_id/download
app.get('/api/clients/:id/documents/:doc_id/download', authMiddleware, (req, res) => {
  try {
    const doc = db.prepare('SELECT * FROM client_documents WHERE id=? AND plan_id=?').get(req.params.doc_id, req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    const filePath = path.join(UPLOADS_DIR, 'clients', req.params.id, doc.filename);
    res.download(filePath, doc.original_name);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/clients/:id/documents/:doc_id
app.delete('/api/clients/:id/documents/:doc_id', authMiddleware, (req, res) => {
  try {
    const doc = db.prepare('SELECT * FROM client_documents WHERE id=? AND plan_id=?').get(req.params.doc_id, req.params.id);
    if (doc) {
      const filePath = path.join(UPLOADS_DIR, 'clients', req.params.id, doc.filename);
      try { fs.unlinkSync(filePath); } catch(e) {}
      db.prepare('DELETE FROM client_documents WHERE id=?').run(req.params.doc_id);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/clients/:id/documents/:doc_id/extract
app.post('/api/clients/:id/documents/:doc_id/extract', authMiddleware, async (req, res) => {
  try {
    const doc = db.prepare('SELECT * FROM client_documents WHERE id=? AND plan_id=?').get(req.params.doc_id, req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    const filePath = path.join(UPLOADS_DIR, 'clients', req.params.id, doc.filename);
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(doc.original_name).toLowerCase();
    const isPDF = buffer[0]===0x25 && buffer[1]===0x50 && buffer[2]===0x44 && buffer[3]===0x46;
    let text = '';
    if (isPDF) { const data = await pdfParse(buffer); text = data.text; }
    else if (ext==='.docx') { const r = await mammoth.extractRawText({buffer}); text = r.value; }
    else if (['.txt','.md','.rtf'].includes(ext)) { text = buffer.toString('utf8'); }
    else { text = buffer.toString('utf8'); }
    console.log(`[upload] Extracted ${text.length} chars from ${ext} file`);
    res.json({ text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- CHAT ROUTES (conversational revision) ----

// GET /api/chat/:plan_id — return all chat messages for a plan
app.get('/api/chat/:plan_id', authMiddleware, (req, res) => {
  try {
    const messages = db.prepare(
      'SELECT * FROM chat_messages WHERE plan_id = ? ORDER BY created_at ASC'
    ).all(req.params.plan_id);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/:plan_id — send a conversational message, Claude replies without regenerating the full plan
app.post('/api/chat/:plan_id', authMiddleware, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });

    const plan = db.prepare('SELECT * FROM plan_history WHERE id = ?').get(req.params.plan_id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const latestRevision = db.prepare(
      'SELECT * FROM plan_revisions WHERE plan_id = ? ORDER BY revision_number DESC LIMIT 1'
    ).get(req.params.plan_id);
    if (!latestRevision) return res.status(404).json({ error: 'No plan revision found' });

    const isReauth = plan.plan_type === 'reauth';

    // Load prior chat messages
    const priorMessages = db.prepare(
      'SELECT role, content FROM chat_messages WHERE plan_id = ? ORDER BY created_at ASC'
    ).all(req.params.plan_id);

    let activeSystemPrompt;
    let messages;

    if (isReauth) {
      // Reauth: inject previous plan + context (goals + new docs) from original_notes
      activeSystemPrompt = REAUTH_SYSTEM_PROMPT;
      messages = [
        {
          role: 'user',
          content: `Here is the previous treatment plan for ${plan.client_name || 'this client'}:\n\n${latestRevision.text}\n\nReauth context (previous goals and new assessment documents):\n${plan.original_notes}`,
        },
        {
          role: 'assistant',
          content: `I've reviewed the previous treatment plan and new assessment documents for ${plan.client_name || 'this client'}. What would you like to start with?`,
        },
        ...priorMessages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: message },
      ];
    } else {
      const activePrompt = db.prepare('SELECT * FROM prompt_versions WHERE is_active = 1').get();
      const systemPrompt = activePrompt ? activePrompt.text : 'You are an ABA treatment plan generator.';
      activeSystemPrompt = `${systemPrompt}\n\n---\nYou are in CONVERSATION MODE helping a BCBA refine a treatment plan. Respond conversationally and concisely. When the user asks for changes, describe what you would change and confirm. Do NOT output the entire treatment plan. Address only the specific request. The user can click "Regenerate Full Plan" when ready to apply all changes at once.`;
      messages = [
        {
          role: 'user',
          content: `Here is the current treatment plan for ${plan.client_name || 'this client'}:\n\n${latestRevision.text}\n\nOriginal client notes:\n${plan.original_notes}`,
        },
        {
          role: 'assistant',
          content: `I've reviewed the treatment plan for ${plan.client_name || 'this client'}. What changes would you like to make?`,
        },
        ...priorMessages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: message },
      ];
    }

    // Save the user message
    db.prepare('INSERT INTO chat_messages (plan_id, role, content, username) VALUES (?, ?, ?, ?)').run(
      req.params.plan_id, 'user', message, req.user.username
    );

    // Stream conversational reply
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    if (res.socket) res.socket.setNoDelay(true);
    res.write(': connected\n\n');

    let replyText = '';
    const stream = anthropic.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: isReauth ? 8000 : 2000,
      system: [{ type: 'text', text: activeSystemPrompt, cache_control: { type: 'ephemeral' } }],
      messages,
    });

    const keepAlive = setInterval(() => res.write(': ping\n\n'), 20000);

    stream.on('text', (chunk) => {
      replyText += chunk;
      res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
    });

    stream.on('finalMessage', () => {
      clearInterval(keepAlive);
      // Save assistant reply
      db.prepare('INSERT INTO chat_messages (plan_id, role, content, username) VALUES (?, ?, ?, ?)').run(
        req.params.plan_id, 'assistant', replyText, 'Claude'
      );
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    });

    stream.on('error', (err) => {
      clearInterval(keepAlive);
      console.error('Chat stream error:', err);
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
      res.end();
    });

  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/:plan_id/regenerate — regenerate the full plan incorporating all chat feedback
app.post('/api/chat/:plan_id/regenerate', authMiddleware, async (req, res) => {
  try {
    const plan = db.prepare('SELECT * FROM plan_history WHERE id = ?').get(req.params.plan_id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const allRevisions = db.prepare(
      'SELECT * FROM plan_revisions WHERE plan_id = ? ORDER BY revision_number ASC'
    ).all(req.params.plan_id);
    if (!allRevisions.length) return res.status(404).json({ error: 'No revisions found' });

    const isReauth = plan.plan_type === 'reauth';

    let regenSystemPrompt;
    if (isReauth) {
      regenSystemPrompt = REAUTH_SYSTEM_PROMPT;
    } else {
      const activePrompt = db.prepare('SELECT * FROM prompt_versions WHERE is_active = 1').get();
      regenSystemPrompt = activePrompt ? activePrompt.text : 'You are an ABA treatment plan generator.';
    }

    // Collect all user chat messages as the feedback list
    const userChatMessages = db.prepare(
      "SELECT content FROM chat_messages WHERE plan_id = ? AND role = 'user' ORDER BY created_at ASC"
    ).all(req.params.plan_id);

    const feedbackList = userChatMessages.map((m, i) => `${i + 1}. ${m.content}`).join('\n');
    const latestRevision = allRevisions[allRevisions.length - 1];

    let userContent;
    if (isReauth) {
      userContent = feedbackList
        ? `${plan.original_notes}\n\nThe BCBA has provided the following guidance during our conversation:\n${feedbackList}\n\nPlease generate the COMPLETE reauthorization treatment plan incorporating all of this guidance. Use the same format and structure as the initial treatment plan. Do not leave any section blank.`
        : `${plan.original_notes}\n\nPlease generate the COMPLETE reauthorization treatment plan. Use the same format and structure as the initial treatment plan. Include all continued, modified, and new goals. Do not leave any section blank.`;
    } else {
      userContent = feedbackList
        ? `${plan.original_notes}\n\nThe BCBA has requested the following changes during our conversation:\n${feedbackList}\n\nPlease regenerate the COMPLETE treatment plan incorporating ALL of these changes. Do not leave any section blank, do not use placeholders — output the entire plan from beginning to end with every requested change applied.`
        : `${plan.original_notes}\n\nIMPORTANT: Generate the COMPLETE treatment plan. Do not leave any section blank, do not use placeholders, and do not skip any section.`;
    }

    // Stream the full plan
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    if (res.socket) res.socket.setNoDelay(true);
    res.write(': connected\n\n');

    let clientConnected = true;
    let keepAlive;
    res.on('close', () => { clientConnected = false; clearInterval(keepAlive); });

    const send = (obj) => {
      if (!clientConnected) return;
      try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {}
    };

    let revisedText = '';
    console.log(`[regenerate] plan_id=${req.params.plan_id} plan_type=${plan.plan_type} input: ${userContent.length.toLocaleString()} chars (~${Math.round(userContent.length/4).toLocaleString()} tokens)`);

    const stream = anthropic.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 32768,
      system: [{ type: 'text', text: regenSystemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }],
    });

    keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20000);

    stream.on('text', (chunk) => {
      revisedText += chunk;
      send({ type: 'chunk', text: chunk });
    });

    stream.on('finalMessage', (msg) => {
      clearInterval(keepAlive);
      const newRevisionNumber = latestRevision.revision_number + 1;
      const feedbackSummary = userChatMessages.length > 0
        ? `Chat regeneration: ${userChatMessages.length} change(s) applied`
        : 'Full regeneration';
      revisedText = stripAIPreamble(revisedText);
      console.log(`[regenerate] done. stop_reason=${msg.stop_reason} output=${revisedText.length.toLocaleString()} chars (${revisedText.split('\n').length} lines)`);

      // Enforce mastery criteria: FERB=90%, non-FERB=80% — don't trust the AI
      const { text: regenTextFixed, ferbFixed: regenFerbFixed, nonFerbFixed: regenNonFerbFixed } = fixMasteryCriteria(revisedText);
      revisedText = regenTextFixed;
      console.log(`[regenerate] Mastery criteria: ${regenFerbFixed} FERB goals fixed to 90%, ${regenNonFerbFixed} non-FERB goals fixed to 80%`);

      // Count goals — matches actual AI format: | **N. Goal Statement:** |
      const REGEN_GOAL_LINE_RE = /\d+\.\s+(?:\(FERB\)\s+)?Goal Statement/i;
      const regenGoalCount = revisedText
        .split('\n')
        .filter(line => REGEN_GOAL_LINE_RE.test(line))
        .length;
      console.log(`[regenerate] Goal count for summary table: ${regenGoalCount}`);
      console.log('[regenerate] GOAL DEBUG: First 10 goal lines found in revisedText:');
      revisedText.split('\n').filter(l => /Goal Statement/i.test(l)).slice(0, 10).forEach(l => console.log('  ', l.slice(0, 120)));
      const regenClientName = plan.client_name || 'Unknown';
      const regenBcbaMatch = revisedText.match(/(?:Supervising BCBA|BCBA Name)[:\s|]+([^\n\r|]+)/i);
      const regenBcbaName = regenBcbaMatch ? regenBcbaMatch[1].trim() : '[BCBA NAME]';
      const regenDateMatch = revisedText.match(/Assessment Date[:\s|]+([^\n\r|]+)/i);
      const regenAssessmentDate = regenDateMatch ? regenDateMatch[1].trim() : '[DATE]';
      const correctRegenGoalTable = buildGoalSummaryTable(regenGoalCount);
      revisedText = revisedText.replace(
        /(##\s+Goal Objective Summary\s*\n)([\s\S]*?)(?=##\s+Response to Treatment)/i,
        (match, header) => header + '\n' + correctRegenGoalTable + '\n\n'
      );
      revisedText = revisedText.replace(
        /(Total\s*#?\s*(?:of\s*)?(?:new\s*)?[Gg]oals[:\s|*]+)\d+/g,
        (match, prefix) => prefix + regenGoalCount
      );
      revisedText = injectBoilerplate(revisedText, regenClientName, regenBcbaName, regenAssessmentDate, regenGoalCount);
      console.log(`[regenerate] Boilerplate injected. Final: ${revisedText.length.toLocaleString()} chars`);

      db.prepare(
        'INSERT INTO plan_revisions (plan_id, revision_number, text, feedback) VALUES (?, ?, ?, ?)'
      ).run(req.params.plan_id, newRevisionNumber, revisedText, feedbackSummary);
      console.log(`[regenerate] saved revision ${newRevisionNumber} for plan_id=${req.params.plan_id}`);
      logActivity(req.user.id, req.user.username, 'regenerated_plan', 'plan', Number(req.params.plan_id), 'Chat regeneration');
      if (clientConnected) {
        send({ type: 'done', revision_number: newRevisionNumber });
        res.end();
      }
    });

    stream.on('error', (err) => {
      clearInterval(keepAlive);
      console.error('Regenerate stream error:', err);
      if (clientConnected) {
        send({ type: 'error', error: err.message });
        res.end();
      }
    });

  } catch (err) {
    console.error('Regenerate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- BACKUP ROUTES ----

app.get('/api/admin/backup', authMiddleware, adminMiddleware, (req, res) => {
  const result = runBackup();
  if (!result) return res.status(500).json({ error: 'Backup failed' });
  res.json({ ok: true, filename: result.filename, bytes: result.bytes });
});

app.get('/api/admin/backup/download', authMiddleware, adminMiddleware, (req, res) => {
  const filename = latestBackup();
  if (!filename) return res.status(404).json({ error: 'No backup found' });
  const filepath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Backup file not found' });
  res.download(filepath, filename);
});

// ---- ACTIVITY LOG ----

app.get('/api/activity-log', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const entries = db.prepare(`
      SELECT a.*, p.client_name
      FROM activity_log a
      LEFT JOIN plan_history p ON a.target_type = 'plan' AND a.target_id = p.id
      ORDER BY a.created_at DESC LIMIT 200
    `).all();
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- SERVE REACT APP ----

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`All Star ABA server running on http://localhost:${PORT}`);

  // Run a backup immediately on startup, then every 24 hours
  runBackup();
  setInterval(runBackup, 24 * 60 * 60 * 1000);
});
