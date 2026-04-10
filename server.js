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
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'allstar-aba-secret-2026';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files from client/dist
app.use(express.static(path.join(__dirname, 'client', 'dist')));

// Uploads directory (use DATA_DIR for Railway volume persistence)
const DATA_DIR = process.env.DATA_DIR || __dirname;
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
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

// Multer memory storage
const upload = multer({ storage: multer.memoryStorage() });

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

// ---- GENERATE ROUTE ----

// ---- EXTRACT CLIENT INFO ----

app.post('/api/extract-client-info', authMiddleware, async (req, res) => {
  try {
    const { notes } = req.body;
    if (!notes) return res.status(400).json({ error: 'Notes are required' });

    const extractionSystemPrompt = `You are a clinical data extractor. Extract client information from ABA therapy intake notes and return ONLY a valid JSON object — no explanation, no markdown, no text outside the JSON.

For each key: return the extracted string value if found, or null if not found/not mentioned. Never guess or fabricate information.

Keys to extract and what to look for:
- client_full_name: Client's full legal name
- date_of_birth: Date of birth (format MM/DD/YYYY)
- date_of_assessment: Date of this assessment/evaluation (format MM/DD/YYYY)
- date_of_reassessment: Date of next reassessment if mentioned (format MM/DD/YYYY)
- parent_guardian_name: Primary parent or guardian full name
- parent_guardian_phone: Primary parent/guardian phone number
- parent_guardian_email: Primary parent/guardian email
- father_caregiver_name: Father or secondary caregiver name
- siblings: Sibling names and ages
- marital_status: Parents' marital status
- individuals_living_in_home: All individuals living in the home
- cultural_legal_issues: Any cultural or legal issues noted
- environmental_factors: Environmental factors mentioned
- safety_concerns: Safety concerns including aggression, SIB, elopement
- medications: All medications with dosage, frequency, and prescriber
- pcp_name: Primary care physician name
- pcp_phone: PCP phone number
- allergies: Known allergies
- medical_concerns: Medical diagnoses or concerns
- dietary_restrictions: Dietary restrictions
- surgery_history: Any surgeries or hospitalizations
- er_history: Emergency room history
- family_mental_health_history: Family mental health history
- pregnancy_complications: Pregnancy complications
- birth_concerns: Birth or neonatal concerns
- delivery_method: Vaginal or cesarean
- weeks_gestation: Weeks gestation at birth
- school_name: Name of school
- school_setting: Type of school placement
- grade: Current grade
- school_schedule: School schedule details
- school_hours_per_week: Hours in school per week
- prior_aba_history: Previous ABA services with provider/dates/hours/reason discontinued
- other_mental_health_services: Other mental health services
- other_services_slp_ot: SLP, OT, or other therapy services
- coordination_providers: Coordination providers with name/role/phone
- major_life_changes: Recent major life changes
- observation_date: Date of clinical observation (format MM/DD/YYYY)
- observation_start_time: Observation start time (format H:MM AM/PM)
- observation_end_time: Observation end time (format H:MM AM/PM)
- observation_location: Location of observation
- individuals_present: Individuals present during observation
- hours_97153: Recommended direct BT hours per week (number only)
- hours_97155: Recommended BCBA direct hours per week (number only)
- hours_97156: Recommended parent training hours per week (number only)
- hours_97151: Assessment hours for this authorization (number only)
- authorization_start_date: Authorization start date (format MM/DD/YYYY)
- authorization_end_date: Authorization end date (format MM/DD/YYYY)
- service_location: Service location (Home, Clinic, School, or combination)
- supervising_bcba_name: Supervising BCBA full name
- supervising_bcba_credentials: BCBA credentials (e.g. M.Ed, BCBA, LBA)
- supervising_bcba_phone: BCBA phone number
- emergency_contact_name: Emergency contact name
- emergency_contact_phone: Emergency contact phone`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: extractionSystemPrompt,
      messages: [{ role: 'user', content: notes }],
    });

    let parsedJson = {};
    try {
      const responseText = message.content[0].text.trim();
      parsedJson = JSON.parse(responseText);
    } catch (e) {
      // Return all nulls if parsing fails
      const allKeys = [
        'client_full_name','date_of_birth','date_of_assessment','date_of_reassessment',
        'parent_guardian_name','parent_guardian_phone','parent_guardian_email','father_caregiver_name',
        'siblings','marital_status','individuals_living_in_home','cultural_legal_issues',
        'environmental_factors','safety_concerns','medications','pcp_name','pcp_phone',
        'allergies','medical_concerns','dietary_restrictions','surgery_history','er_history',
        'family_mental_health_history','pregnancy_complications','birth_concerns','delivery_method',
        'weeks_gestation','school_name','school_setting','grade','school_schedule',
        'school_hours_per_week','prior_aba_history','other_mental_health_services',
        'other_services_slp_ot','coordination_providers','major_life_changes','observation_date',
        'observation_start_time','observation_end_time','observation_location','individuals_present',
        'hours_97153','hours_97155','hours_97156','hours_97151','authorization_start_date',
        'authorization_end_date','service_location','supervising_bcba_name',
        'supervising_bcba_credentials','supervising_bcba_phone','emergency_contact_name',
        'emergency_contact_phone'
      ];
      parsedJson = Object.fromEntries(allKeys.map(k => [k, null]));
    }

    res.json({ found: parsedJson });
  } catch (err) {
    console.error('Extract client info error:', err);
    res.status(500).json({ error: err.message });
  }
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

// The 4 sequential generation prompts — each builds on the previous sections as context
const GENERATION_SECTIONS = [
  {
    number: 1,
    label: 'Client Info, Narrative & Assessments',
    instruction: `Generate ONLY sections 1 through 14 of the ABA treatment plan, in this exact order:
1. "ABA Treatment Plan" title header
2. ☐ Review checkbox: "☐ I reviewed the ABA treatment plan requirements before submitting this report."
3. Client Information table (Name, DOB, Assessment Date, Reassessment Date, Guardian Contact)
4. Biopsychosocial Information: Current Family Structure table, Medications table, Medical History table including Birth History
5. History of ABA Services table
6. Other Mental Health Services table and Other Services table
7. Coordination of Care section with coordination language and provider table
8. Major Life Changes table
9. Narrative section: Direct Observation table (Date, Start Time, End Time, Location, Individuals Present) + full Clinical Narrative written as flowing prose with domain sub-headers: Communication, Social, Adaptive/Safety Skills, Challenging Behaviors
10. Strengths, Challenges & Severity Level — four complete domain boxes (Language/Communication, Social Skills, Adaptive/Self-Care, Challenging Behaviors), each with a Strengths paragraph, Challenges paragraph, and Severity: ☐ Mild ☐ Moderate ☐ Severe
11. Standardized Assessment — Vineland-3 boilerplate introduction + ABC and Domain Score Summary table + Subdomain Score Summary table + Maladaptive Behavior Score Summary table
12. Criterion-Referenced Assessment — VB-MAPP or ABLLS-R boilerplate introduction + score narrative
13. Goal Objective Summary table (columns: Total Goals, Mastered, In-Progress, On Hold, Discontinued, New)
14. Response to Treatment / Authorization Summary (write "N/A — Initial Treatment Plan" for initial plans)

STOP after section 14. Do NOT write skill acquisition goals, BIPs, behavior reduction, parent training, generalization, fading, discharge, crisis, recommendations, CPT codes, provider info, or consent.`,
  },
  {
    number: 2,
    label: 'Skill Acquisition Goals & Behavior Intervention Plans',
    instruction: `The treatment plan sections 1–14 have already been written above. Continue the plan — do not repeat anything already written.

Generate ONLY sections 15 and 16:

15. Skill Acquisition Goals — organized by domain with bold sub-headers:
    • Language/Communication Goals
    • Social Goals
    • Adaptive/Self-Care Goals
    Generate 25–40 goals total. Use this EXACT format for EVERY goal:
      Medical Necessity Rationale: Core Deficit of ASD Addressed:
      A. [criterion A bullet]
      B. [criterion B bullet]
      C. [criterion C bullet if applicable]
      [Number]. Goal Statement: [include FERB prefix if applicable] When [condition], [client name] will [behavior] in [X]% of opportunities across 5 consecutive sessions, in two settings, and in the presence of two people.
      Baseline: [data] on [date]
      Date of Introduction: [date]
      Projected Mastery: [date ~6 months out]
      Progress Data: N/A

16. Behavior Intervention Plans — organized by FUNCTION (not topography). Include only the functions relevant to this client:
    • Social Negative Reinforcement (escape-maintained behaviors)
    • Social Positive Reinforcement (access-maintained behaviors)
    • Automatic Positive Reinforcement (sensory/automatically-maintained behaviors)
    Each BIP must include: Date, Behavior Assessment, Target Behavior (list all topographies), Operational Definition, Quantitative Baseline Data, Hypothesized Function, Functionally Equivalent Replacement Behaviors (reference specific goal numbers from section 15), Antecedent Interventions (detailed with sub-headers), Consequence Interventions (detailed with sub-headers), De-escalation Procedures (use the standard de-escalation protocol verbatim).

STOP after section 16. Do NOT write behavior reduction, parent training, generalization, fading, discharge, crisis, or any later sections.`,
  },
  {
    number: 3,
    label: 'Behavior Reduction, Parent Training, Generalization & Fading',
    instruction: `Sections 1–16 of the treatment plan have been written above. Continue — do not repeat anything.

Generate ONLY sections 17 through 21:

17. Behavior Reduction Goals — one goal per target behavior, using the exact same goal format (Medical Necessity Rationale, Goal Statement, Baseline, Date of Introduction, Projected Mastery, Progress Data)

18. Parent or Caregiver Training — at least 2 goals using the standard parent training boilerplate language exactly as specified in your instructions

19. Generalization Plan — use the exact 6-step generalization protocol from your instructions, verbatim. Follow with Data Collection Standard Language verbatim.

20. Maintenance Protocol — use the exact maintenance schedule from your instructions (Daily → Weekly → Semi-monthly → Monthly → Bi-monthly → Semi-annually), verbatim.

21. Transition and Fading Plan — include both fading plan boilerplate introduction paragraphs verbatim, then all 4 phases using the exact phase structure. Each phase's opening sentence MUST embed mastery, maintenance, and generalization criteria. Reference specific skill acquisition goal numbers from section 15 in each phase. End with Discharge Criteria using the exact standard list from your instructions.

STOP after the Discharge Criteria. Do NOT write the crisis plan, recommendations, CPT codes, provider info, or consent.`,
  },
  {
    number: 4,
    label: 'Crisis Plan, Recommendations & Consent',
    instruction: `Sections 1–21 of the treatment plan have been written above. Now write the final sections — do not repeat anything.

Generate ONLY sections 22 through 25:

22. Crisis Plan — Emergency contacts table with columns (Emergency/Crisis Type | Date of Implementation | Protocol | Contact Plan | Notes) + individualized crisis protocol table for clients with SIB, aggression, elopement, or safety behaviors + Post-Crisis Procedures section. If the client has no significant safety behaviors, write "At this time, the client does not require an individualized crisis plan."

23. Recommendations for ABA Services — write the medical necessity boilerplate paragraph verbatim, then format CPT codes as a TABLE with exactly these four columns: CPT Code | Number of Hours Requested | Total Units | Place of Service. Calculate Total Units as hours/week × 26 weeks × 4 units/hour and show the calculation inline (e.g. "2,600 (25 hrs/wk × 26 wks × 4)"). Include rows for 97151, 97153, 97155-GT, and 97156-GT/U2. Then include the Anticipated Schedule.

24. Provider Information table (Provider Name, Credentials, Signature, Date, NPI) + Attestation using this exact text: "I hereby attest that I have individually reviewed the listed items and confirm they are true and correct." + Clinical Reviewer section with signature line.

25. Consent — use ONLY this exact text: "I have read the goals and behavior intervention plan as outlined in this report. I have been provided with the opportunity to ask any questions, my questions have been answered, and with this knowledge, I voluntarily consent to this treatment plan." Followed by EXACTLY these three signature lines and nothing else:
    Client Signature: ______________________________ Date: ______________
    Parent/Caregiver Signature: ____________________ Date: ______________
    Date: ______________

This is the end of the treatment plan. No additional text after the consent section.`,
  },
];

app.post('/api/generate', authMiddleware, async (req, res) => {
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 20000);

  try {
    const { notes, clientInfo } = req.body;
    if (!notes) {
      clearInterval(keepAlive);
      return res.status(400).json({ error: 'Notes are required' });
    }

    const activePrompt = db.prepare('SELECT * FROM prompt_versions WHERE is_active = 1').get();
    const systemPrompt = activePrompt ? activePrompt.text : 'You are an ABA treatment plan generator.';

    // Client name
    let clientName = 'Unknown';
    if (clientInfo?.client_full_name) {
      clientName = clientInfo.client_full_name;
    } else {
      const nameMatch = notes.match(/(?:client|name)\s*:\s*([^\n,]+)/i);
      if (nameMatch) clientName = nameMatch[1].trim();
    }

    // Base user message (verified client info + original notes)
    const baseMessage = clientInfo && Object.keys(clientInfo).length > 0
      ? `${formatClientInfoForPrompt(clientInfo)}\n=== ORIGINAL BCBA NOTES ===\n${notes}`
      : notes;

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');

    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    let fullPlanText = '';

    // Run 4 sequential generation calls
    for (const sec of GENERATION_SECTIONS) {
      send({ type: 'progress', section: sec.number, total: GENERATION_SECTIONS.length, label: sec.label });

      // Build messages: for calls 2-4, pass accumulated text as prior assistant turn
      const messages = fullPlanText
        ? [
            { role: 'user', content: baseMessage },
            { role: 'assistant', content: fullPlanText },
            { role: 'user', content: sec.instruction },
          ]
        : [{ role: 'user', content: `${baseMessage}\n\n${sec.instruction}` }];

      let sectionText = '';

      await new Promise((resolve, reject) => {
        const stream = anthropic.messages.stream({
          model: 'claude-opus-4-6',
          max_tokens: 8000,
          system: systemPrompt,
          messages,
        });

        stream.on('text', (chunk) => {
          sectionText += chunk;
          send({ type: 'chunk', text: chunk });
        });

        stream.on('finalMessage', () => {
          fullPlanText += (fullPlanText ? '\n\n' : '') + sectionText;
          resolve();
        });

        stream.on('error', reject);
      });
    }

    clearInterval(keepAlive);

    // Try to refine client name from generated text
    const planNameMatch = fullPlanText.match(/Participant Name[:\s]+([^\n\r]+)/i);
    if (planNameMatch && clientName === 'Unknown') clientName = planNameMatch[1].trim();

    // Save to DB
    const planInsert = db.prepare(
      'INSERT INTO plan_history (user_id, client_name, original_notes) VALUES (?, ?, ?)'
    ).run(req.user.id, clientName, notes);
    const planId = planInsert.lastInsertRowid;

    db.prepare(
      'INSERT INTO plan_revisions (plan_id, revision_number, text, feedback) VALUES (?, ?, ?, ?)'
    ).run(planId, 0, fullPlanText, 'Initial generation');

    if (clientInfo && Object.keys(clientInfo).length > 0) {
      db.prepare('INSERT OR REPLACE INTO client_info (plan_id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
        .run(planId, JSON.stringify(clientInfo));
    }

    send({ type: 'done', plan_id: planId, client_name: clientName });
    res.end();

  } catch (err) {
    clearInterval(keepAlive);
    console.error('Generate error:', err);
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
      content: `${feedback}\n\nIMPORTANT: Return the COMPLETE, full treatment plan with this change incorporated. Do not leave any section blank, do not use placeholders, and do not skip any section — output the entire plan from beginning to end with all original sections fully written out and only the requested change made.`,
    });

    // Stream the response to prevent Railway's request timeout from cutting off long generations
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');

    let revisedText = '';
    const stream = anthropic.messages.stream({
      model: 'claude-opus-4-6',
      max_tokens: 16000,
      system: systemPrompt,
      messages,
    });

    // Send periodic keep-alive comments so the connection stays open
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 20000);

    stream.on('text', (chunk) => {
      revisedText += chunk;
      res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
    });

    stream.on('finalMessage', async () => {
      clearInterval(keepAlive);
      const newRevisionNumber = allRevisions[allRevisions.length - 1].revision_number + 1;
      db.prepare(
        'INSERT INTO plan_revisions (plan_id, revision_number, text, feedback) VALUES (?, ?, ?, ?)'
      ).run(plan_id, newRevisionNumber, revisedText, feedback);
      res.write(`data: ${JSON.stringify({ type: 'done', revision_number: newRevisionNumber })}\n\n`);
      res.end();
    });

    stream.on('error', (err) => {
      clearInterval(keepAlive);
      console.error('Revise stream error:', err);
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
      res.end();
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
    } else if (ext === '.docx' || (isZip && ext !== '.zip')) {
      const result = await mammoth.extractRawText({ buffer });
      extractedText = result.value;
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

    res.json({ text: extractedText });
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

app.put('/api/prompt', authMiddleware, (req, res) => {
  try {
    const { text, label } = req.body;
    if (!text || !label) return res.status(400).json({ error: 'text and label are required' });

    db.prepare('UPDATE prompt_versions SET is_active = 0').run();
    const result = db.prepare(
      'INSERT INTO prompt_versions (text, label, is_active) VALUES (?, ?, 1)'
    ).run(text, label);

    const newPrompt = db.prepare('SELECT * FROM prompt_versions WHERE id = ?').get(result.lastInsertRowid);
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

app.post('/api/prompt/restore/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const prompt = db.prepare('SELECT * FROM prompt_versions WHERE id = ?').get(id);
    if (!prompt) return res.status(404).json({ error: 'Prompt version not found' });

    db.prepare('UPDATE prompt_versions SET is_active = 0').run();
    db.prepare('UPDATE prompt_versions SET is_active = 1 WHERE id = ?').run(id);

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
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ message: 'User deleted' });
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

    const doc = buildDocx(revision.text, plan.client_name);
    const buffer = await Packer.toBuffer(doc);
    const safeName = (plan.client_name || 'treatment-plan').replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-');
    const filename = `treatment-plan-${safeName}-rev${revision_number}.docx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
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
    const uploadDir = path.join(UPLOADS_DIR, 'clients', req.params.id);
    if (fs.existsSync(uploadDir)) fs.rmSync(uploadDir, { recursive: true, force: true });
    db.prepare('DELETE FROM client_documents WHERE plan_id=?').run(req.params.id);
    db.prepare('DELETE FROM plan_revisions WHERE plan_id=?').run(req.params.id);
    db.prepare('DELETE FROM plan_history WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/clients/:id/documents — upload a document
app.post('/api/clients/:id/documents', authMiddleware, uploadClient.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { originalname, filename, mimetype, size } = req.file;
    const ext = path.extname(originalname).toLowerCase();
    const result = db.prepare(
      'INSERT INTO client_documents (plan_id, filename, original_name, file_type, file_size, uploaded_by) VALUES (?,?,?,?,?,?)'
    ).run(req.params.id, filename, originalname, ext || mimetype, size, req.user.id);
    const doc = db.prepare('SELECT cd.*, u.username AS uploader FROM client_documents cd LEFT JOIN users u ON cd.uploaded_by=u.id WHERE cd.id=?').get(result.lastInsertRowid);
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/clients/:id/documents — list documents
app.get('/api/clients/:id/documents', authMiddleware, (req, res) => {
  try {
    const docs = db.prepare(`SELECT cd.*, u.username AS uploader FROM client_documents cd LEFT JOIN users u ON cd.uploaded_by=u.id WHERE cd.plan_id=? ORDER BY cd.uploaded_at DESC`).all(req.params.id);
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
    res.json({ text: text.slice(0, 50000) });
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

    const activePrompt = db.prepare('SELECT * FROM prompt_versions WHERE is_active = 1').get();
    const systemPrompt = activePrompt ? activePrompt.text : 'You are an ABA treatment plan generator.';

    // Load prior chat messages
    const priorMessages = db.prepare(
      'SELECT role, content FROM chat_messages WHERE plan_id = ? ORDER BY created_at ASC'
    ).all(req.params.plan_id);

    // Build conversation: context injection + prior chat + new message
    const messages = [
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

    // Save the user message
    db.prepare('INSERT INTO chat_messages (plan_id, role, content) VALUES (?, ?, ?)').run(
      req.params.plan_id, 'user', message
    );

    // Stream conversational reply
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');

    let replyText = '';
    const conversationSystemPrompt = `${systemPrompt}\n\n---\nYou are in CONVERSATION MODE helping a BCBA refine a treatment plan. Respond conversationally and concisely. When the user asks for changes, describe what you would change and confirm. Do NOT output the entire treatment plan. Address only the specific request. The user can click "Regenerate Full Plan" when ready to apply all changes at once.`;

    const stream = anthropic.messages.stream({
      model: 'claude-opus-4-6',
      max_tokens: 2000,
      system: conversationSystemPrompt,
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
      db.prepare('INSERT INTO chat_messages (plan_id, role, content) VALUES (?, ?, ?)').run(
        req.params.plan_id, 'assistant', replyText
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

    const activePrompt = db.prepare('SELECT * FROM prompt_versions WHERE is_active = 1').get();
    const systemPrompt = activePrompt ? activePrompt.text : 'You are an ABA treatment plan generator.';

    // Collect all user chat messages as the feedback list
    const userChatMessages = db.prepare(
      "SELECT content FROM chat_messages WHERE plan_id = ? AND role = 'user' ORDER BY created_at ASC"
    ).all(req.params.plan_id);

    const feedbackList = userChatMessages.map((m, i) => `${i + 1}. ${m.content}`).join('\n');
    const latestRevision = allRevisions[allRevisions.length - 1];

    const userContent = feedbackList
      ? `${plan.original_notes}\n\nThe BCBA has requested the following changes during our conversation:\n${feedbackList}\n\nPlease regenerate the COMPLETE treatment plan incorporating ALL of these changes. Do not leave any section blank, do not use placeholders — output the entire plan from beginning to end with every requested change applied.`
      : `${plan.original_notes}\n\nIMPORTANT: Generate the COMPLETE treatment plan. Do not leave any section blank, do not use placeholders, and do not skip any section.`;

    // Stream the full plan
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');

    let revisedText = '';
    const stream = anthropic.messages.stream({
      model: 'claude-opus-4-6',
      max_tokens: 16000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    });

    const keepAlive = setInterval(() => res.write(': ping\n\n'), 20000);

    stream.on('text', (chunk) => {
      revisedText += chunk;
      res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
    });

    stream.on('finalMessage', () => {
      clearInterval(keepAlive);
      const newRevisionNumber = latestRevision.revision_number + 1;
      const feedbackSummary = userChatMessages.length > 0
        ? `Chat regeneration: ${userChatMessages.length} change(s) applied`
        : 'Full regeneration';
      db.prepare(
        'INSERT INTO plan_revisions (plan_id, revision_number, text, feedback) VALUES (?, ?, ?, ?)'
      ).run(req.params.plan_id, newRevisionNumber, revisedText, feedbackSummary);
      res.write(`data: ${JSON.stringify({ type: 'done', revision_number: newRevisionNumber })}\n\n`);
      res.end();
    });

    stream.on('error', (err) => {
      clearInterval(keepAlive);
      console.error('Regenerate stream error:', err);
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
      res.end();
    });

  } catch (err) {
    console.error('Regenerate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- SERVE REACT APP ----

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`All Star ABA server running on http://localhost:${PORT}`);
});
