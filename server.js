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

app.post('/api/generate', authMiddleware, async (req, res) => {
  try {
    const { notes } = req.body;
    if (!notes) return res.status(400).json({ error: 'Notes are required' });

    const activePrompt = db.prepare('SELECT * FROM prompt_versions WHERE is_active = 1').get();
    const systemPrompt = activePrompt ? activePrompt.text : 'You are an ABA treatment plan generator.';

    // Extract client name from notes
    let clientName = 'Unknown';
    const nameMatch = notes.match(/(?:client|name)\s*:\s*([^\n,]+)/i);
    if (nameMatch) {
      clientName = nameMatch[1].trim();
    }

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 16000,
      system: systemPrompt,
      messages: [{ role: 'user', content: `${notes}\n\nIMPORTANT: Generate the COMPLETE treatment plan. Do not leave any section blank, do not use placeholders, and do not skip any section. Every section must be fully written out from beginning to end.` }]
    });

    const planText = response.content[0].text;

    // Try to extract client name from generated plan text (more reliable than notes)
    const planNameMatch = planText.match(/Participant Name[:\s]+([^\n\r]+)/i);
    if (planNameMatch) clientName = planNameMatch[1].trim();

    // Save to plan_history
    const planInsert = db.prepare(
      'INSERT INTO plan_history (user_id, client_name, original_notes) VALUES (?, ?, ?)'
    ).run(req.user.id, clientName, notes);

    const planId = planInsert.lastInsertRowid;

    // Save initial revision
    db.prepare(
      'INSERT INTO plan_revisions (plan_id, revision_number, text, feedback) VALUES (?, ?, ?, ?)'
    ).run(planId, 0, planText, 'Initial generation');

    res.json({ plan_id: planId, text: planText, client_name: clientName });
  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message });
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

// ---- TEMP: Delete corrupt short revisions ----
app.post('/api/admin/clean-revisions', authMiddleware, (req, res) => {
  if (req.user.role !== 'Admin') return res.status(403).json({ error: 'Admin only' });
  // Delete revisions shorter than 10000 chars that are NOT revision 0
  const bad = db.prepare(
    "SELECT id, plan_id, revision_number, length(text) as len FROM plan_revisions WHERE revision_number > 0 AND length(text) < 10000"
  ).all();
  for (const r of bad) {
    db.prepare('DELETE FROM plan_revisions WHERE id = ?').run(r.id);
  }
  res.json({ deleted: bad.length, revisions: bad.map(r => ({ id: r.id, plan_id: r.plan_id, rev: r.revision_number, len: r.len })) });
});

// ---- SERVE REACT APP ----

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`All Star ABA server running on http://localhost:${PORT}`);
});
