const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

// DATA_DIR allows Railway volume mount (e.g. /data) for persistent storage
const DATA_DIR = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'allstar.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('Admin', 'BCBA')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS prompt_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    label TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS plan_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    client_name TEXT DEFAULT '',
    original_notes TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS plan_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL,
    revision_number INTEGER NOT NULL,
    text TEXT NOT NULL,
    feedback TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (plan_id) REFERENCES plan_history(id)
  );
`);

// Seed default users
const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  const adminHash = bcrypt.hashSync('allstar2026', 10);
  const bcbaHash = bcrypt.hashSync('allstar2026', 10);
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('admin', adminHash, 'Admin');
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('bcba', bcbaHash, 'BCBA');
}

// Seed system prompt (first run only)
const promptExists = db.prepare('SELECT id FROM prompt_versions WHERE id = 1').get();
if (!promptExists) {
  let systemPromptText = 'System prompt will be loaded here';
  const systemPromptPath = path.join(__dirname, 'system-prompt.txt');
  if (fs.existsSync(systemPromptPath)) {
    systemPromptText = fs.readFileSync(systemPromptPath, 'utf8');
  }
  db.prepare('INSERT INTO prompt_versions (text, label, is_active) VALUES (?, ?, 1)')
    .run(systemPromptText, 'Initial System Prompt');
}

// Migration: update active prompt with latest system-prompt.txt if the file is newer than the DB entry
// Controlled by a version marker so it only runs once per new file version
const SYSTEM_PROMPT_VERSION = 'v9-boilerplate-extracted-2026-04-10';
const migrationDone = db.prepare("SELECT id FROM prompt_versions WHERE label = ?").get(SYSTEM_PROMPT_VERSION);
if (!migrationDone) {
  const systemPromptPath = path.join(__dirname, 'system-prompt.txt');
  if (fs.existsSync(systemPromptPath)) {
    const newText = fs.readFileSync(systemPromptPath, 'utf8');
    db.prepare('UPDATE prompt_versions SET is_active = 0').run();
    db.prepare('INSERT INTO prompt_versions (text, label, is_active) VALUES (?, ?, 1)')
      .run(newText, SYSTEM_PROMPT_VERSION);
  }
}

// Add new columns and tables for Client Records feature
try { db.exec("ALTER TABLE plan_history ADD COLUMN status TEXT DEFAULT 'Draft'"); } catch(e) {}
try { db.exec("ALTER TABLE plan_history ADD COLUMN notes TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE chat_messages ADD COLUMN username TEXT DEFAULT ''"); } catch(e) {}

// Chat messages for conversational revision
db.exec(`CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (plan_id) REFERENCES plan_history(id)
)`);

db.exec(`CREATE TABLE IF NOT EXISTS authorization_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  period_number INTEGER NOT NULL,
  period_type TEXT NOT NULL CHECK(period_type IN ('initial', 'reauth')),
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'pending')),
  plan_revision_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (plan_id) REFERENCES plan_history(id),
  FOREIGN KEY (plan_revision_id) REFERENCES plan_revisions(id)
)`);

try { db.exec("ALTER TABLE client_documents ADD COLUMN authorization_period_id INTEGER"); } catch(e) {}

db.exec(`CREATE TABLE IF NOT EXISTS client_info (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER UNIQUE NOT NULL,
  data TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (plan_id) REFERENCES plan_history(id)
)`);

db.exec(`CREATE TABLE IF NOT EXISTS client_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER DEFAULT 0,
  uploaded_by INTEGER NOT NULL,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (plan_id) REFERENCES plan_history(id),
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
)`);

db.exec(`CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id INTEGER,
  details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

module.exports = db;
