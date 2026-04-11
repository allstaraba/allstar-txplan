'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_PATH = path.join(DATA_DIR, 'allstar.db');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MAX_BACKUPS = 30;

function pad(n) {
  return String(n).padStart(2, '0');
}

function timestampedFilename() {
  const now = new Date();
  const y = now.getFullYear();
  const mo = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const h = pad(now.getHours());
  const m = pad(now.getMinutes());
  return `allstar-${y}${mo}${d}-${h}${m}.db`;
}

function runBackup() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });

    if (!fs.existsSync(DB_PATH)) {
      console.log('[backup] Database file not found, skipping backup.');
      return null;
    }

    const filename = timestampedFilename();
    const dest = path.join(BACKUP_DIR, filename);

    fs.copyFileSync(DB_PATH, dest);

    const bytes = fs.statSync(dest).size;
    const kb = (bytes / 1024).toFixed(1);
    console.log(`[backup] Created ${filename} (${kb} KB)`);

    // Prune old backups — keep only the newest MAX_BACKUPS files
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('allstar-') && f.endsWith('.db'))
      .sort(); // lexicographic = chronological for YYYYMMDD-HHMM format

    if (files.length > MAX_BACKUPS) {
      const toDelete = files.slice(0, files.length - MAX_BACKUPS);
      for (const f of toDelete) {
        fs.unlinkSync(path.join(BACKUP_DIR, f));
        console.log(`[backup] Deleted old backup: ${f}`);
      }
    }

    return { filename, bytes };
  } catch (err) {
    console.error('[backup] Backup failed:', err.message);
    return null;
  }
}

function latestBackup() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return null;
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('allstar-') && f.endsWith('.db'))
      .sort();
    return files.length ? files[files.length - 1] : null;
  } catch {
    return null;
  }
}

module.exports = { runBackup, latestBackup, BACKUP_DIR };
