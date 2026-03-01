require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const Anthropic = require('@anthropic-ai/sdk');
const { google } = require('googleapis');
const path = require('path');

const app = express();
const db = new Database(path.join(__dirname, 'workproducts.db'));
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  (process.env.APP_URL || 'http://localhost:3000') + '/auth/gmail/callback'
);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Database schema ────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS work_products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    description TEXT    DEFAULT '',
    status      TEXT    DEFAULT 'todo',
    ai_summary  TEXT    DEFAULT '',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS emails (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    work_product_id  INTEGER NOT NULL,
    subject          TEXT    DEFAULT '',
    from_email       TEXT    DEFAULT '',
    to_email         TEXT    DEFAULT '',
    body             TEXT    DEFAULT '',
    ai_reply         TEXT    DEFAULT '',
    received_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (work_product_id) REFERENCES work_products(id)
  );

  CREATE TABLE IF NOT EXISTS notes (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    work_product_id  INTEGER NOT NULL,
    content          TEXT    NOT NULL,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (work_product_id) REFERENCES work_products(id)
  );

  CREATE TABLE IF NOT EXISTS gmail_tokens (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    access_token  TEXT,
    refresh_token TEXT,
    expiry_date   INTEGER
  );
`);

try { db.exec('ALTER TABLE emails ADD COLUMN gmail_message_id TEXT'); } catch (_) {}

function getGmailClient() {
  const tokens = db.prepare('SELECT * FROM gmail_tokens WHERE id = 1').get();
  if (!tokens?.access_token) return null;
  oauth2Client.setCredentials({
    access_token:  tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date:   tokens.expiry_date,
  });
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

// ── Work Products ──────────────────────────────────────────────────────────
app.get('/api/work-products', (req, res) => {
  const rows = db.prepare(`
    SELECT wp.*,
           COUNT(DISTINCT e.id) AS email_count,
           COUNT(DISTINCT n.id) AS note_count
    FROM work_products wp
    LEFT JOIN emails e ON e.work_product_id = wp.id
    LEFT JOIN notes  n ON n.work_product_id = wp.id
    GROUP BY wp.id
    ORDER BY wp.updated_at DESC
  `).all();
  res.json(rows);
});

app.get('/api/work-products/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM work_products WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

app.post('/api/work-products', (req, res) => {
  const { title, description = '', status = 'todo' } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });
  const result = db.prepare(
    'INSERT INTO work_products (title, description, status) VALUES (?, ?, ?)'
  ).run(title.trim(), description, status);
  res.json(db.prepare('SELECT * FROM work_products WHERE id = ?').get(result.lastInsertRowid));
});

app.put('/api/work-products/:id', (req, res) => {
  const { title, description, status } = req.body;
  const existing = db.prepare('SELECT * FROM work_products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare(`
    UPDATE work_products
    SET title = ?, description = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    title ?? existing.title,
    description ?? existing.description,
    status ?? existing.status,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM work_products WHERE id = ?').get(req.params.id));
});

app.delete('/api/work-products/:id', (req, res) => {
  db.prepare('DELETE FROM emails WHERE work_product_id = ?').run(req.params.id);
  db.prepare('DELETE FROM notes  WHERE work_product_id = ?').run(req.params.id);
  db.prepare('DELETE FROM work_products WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Emails ─────────────────────────────────────────────────────────────────
app.get('/api/work-products/:id/emails', (req, res) => {
  res.json(
    db.prepare('SELECT * FROM emails WHERE work_product_id = ? ORDER BY received_at DESC').all(req.params.id)
  );
});

app.post('/api/work-products/:id/emails', (req, res) => {
  const { subject = '', from_email = '', to_email = '', body = '', received_at } = req.body;
  const result = db.prepare(`
    INSERT INTO emails (work_product_id, subject, from_email, to_email, body, received_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.params.id, subject, from_email, to_email, body, received_at || new Date().toISOString());
  db.prepare('UPDATE work_products SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
  res.json(db.prepare('SELECT * FROM emails WHERE id = ?').get(result.lastInsertRowid));
});

app.delete('/api/emails/:id', (req, res) => {
  db.prepare('DELETE FROM emails WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Notes ──────────────────────────────────────────────────────────────────
app.get('/api/work-products/:id/notes', (req, res) => {
  res.json(
    db.prepare('SELECT * FROM notes WHERE work_product_id = ? ORDER BY created_at DESC').all(req.params.id)
  );
});

app.post('/api/work-products/:id/notes', (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Content is required' });
  const result = db.prepare('INSERT INTO notes (work_product_id, content) VALUES (?, ?)').run(req.params.id, content.trim());
  db.prepare('UPDATE work_products SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
  res.json(db.prepare('SELECT * FROM notes WHERE id = ?').get(result.lastInsertRowid));
});

app.delete('/api/notes/:id', (req, res) => {
  db.prepare('DELETE FROM notes WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── AI: Generate Email Reply ───────────────────────────────────────────────
app.post('/api/emails/:id/ai-reply', async (req, res) => {
  const email = db.prepare(`
    SELECT e.*, wp.title AS wp_title, wp.description AS wp_description
    FROM emails e
    JOIN work_products wp ON wp.id = e.work_product_id
    WHERE e.id = ?
  `).get(req.params.id);
  if (!email) return res.status(404).json({ error: 'Email not found' });

  const { tone = 'professional' } = req.body;
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `You are helping manage a work product called "${email.wp_title}".

Work product description: ${email.wp_description || 'No description provided.'}

Please write a ${tone} email reply to this email:

Subject: ${email.subject}
From: ${email.from_email}
To: ${email.to_email}

Body:
${email.body}

Write a complete, ready-to-send reply. Start with "Re: ${email.subject}" as the subject line on the first line, then a blank line, then the email body. Be concise and helpful.`
      }]
    });
    const reply = msg.content[0].text;
    db.prepare('UPDATE emails SET ai_reply = ? WHERE id = ?').run(reply, req.params.id);
    res.json({ reply });
  } catch (err) {
    console.error('AI reply error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── AI: Generate Work Product Summary ─────────────────────────────────────
app.post('/api/work-products/:id/ai-summary', async (req, res) => {
  const product = db.prepare('SELECT * FROM work_products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Not found' });

  const emails = db.prepare('SELECT * FROM emails WHERE work_product_id = ? ORDER BY received_at ASC').all(req.params.id);
  const notes  = db.prepare('SELECT * FROM notes  WHERE work_product_id = ? ORDER BY created_at ASC').all(req.params.id);

  const emailBlock = emails.length
    ? emails.map((e, i) => `Email ${i + 1}:\nFrom: ${e.from_email}\nSubject: ${e.subject}\n${e.body}`).join('\n\n---\n\n')
    : 'No emails.';

  const notesBlock = notes.length
    ? notes.map(n => `- ${n.content}`).join('\n')
    : 'No notes.';

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Summarize this work product for a busy professional who needs a quick status check.

Title: ${product.title}
Status: ${product.status}
Description: ${product.description || 'None'}

Emails:
${emailBlock}

Notes:
${notesBlock}

Provide exactly these four sections with these headers:

**Summary**
2-3 sentences on what this work product is about and its current state.

**Outstanding / To-Do**
Bullet list of every open item, pending decision, or thing waiting on someone. Be specific — include who owns each if mentioned.

**Next Steps**
Ordered list of the most important immediate actions to move this forward.

**Risks & Blockers**
Any blockers, deadlines, or risks. Write "None identified." if clean.

Be direct and specific. No filler.`
      }]
    });
    const summary = msg.content[0].text;
    db.prepare('UPDATE work_products SET ai_summary = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(summary, req.params.id);
    res.json({ summary });
  } catch (err) {
    console.error('AI summary error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Gmail OAuth ────────────────────────────────────────────────────────────
app.get('/auth/gmail', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    prompt: 'consent',
  });
  res.redirect(url);
});

app.get('/auth/gmail/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/?gmail=error');
  try {
    const { tokens } = await oauth2Client.getToken(code);
    db.prepare(`
      INSERT INTO gmail_tokens (id, access_token, refresh_token, expiry_date)
      VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        access_token  = excluded.access_token,
        refresh_token = COALESCE(excluded.refresh_token, refresh_token),
        expiry_date   = excluded.expiry_date
    `).run(tokens.access_token, tokens.refresh_token || null, tokens.expiry_date || null);
    res.redirect('/?gmail=connected');
  } catch (err) {
    console.error('Gmail OAuth error:', err.message);
    res.redirect('/?gmail=error');
  }
});

app.get('/api/gmail/status', (req, res) => {
  const row = db.prepare('SELECT id FROM gmail_tokens WHERE id = 1').get();
  res.json({ connected: !!row });
});

app.get('/api/gmail/sync', async (req, res) => {
  const gmail = getGmailClient();
  if (!gmail) return res.status(401).json({ error: 'Gmail not connected' });
  const q          = req.query.q || 'in:inbox';
  const maxResults = Math.min(parseInt(req.query.max) || 30, 50);

  try {
    const listRes  = await gmail.users.messages.list({ userId: 'me', maxResults, q });
    const messages = listRes.data.messages || [];
    if (!messages.length) return res.json({ emails: [] });

    const emails = await Promise.all(messages.map(async m => {
      const msg     = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
      const headers = msg.data.payload?.headers || [];
      const h       = name => headers.find(x => x.name.toLowerCase() === name.toLowerCase())?.value || '';

      function extractText(part) {
        if (!part) return '';
        if (part.mimeType === 'text/plain' && part.body?.data)
          return Buffer.from(part.body.data, 'base64').toString('utf-8');
        if (part.parts) {
          for (const p of part.parts) { const t = extractText(p); if (t) return t; }
        }
        return '';
      }

      let body = extractText(msg.data.payload);
      if (!body && msg.data.payload?.body?.data)
        body = Buffer.from(msg.data.payload.body.data, 'base64').toString('utf-8');

      const existing = db.prepare('SELECT id, work_product_id FROM emails WHERE gmail_message_id = ?').get(m.id);
      return {
        gmail_message_id: m.id,
        subject:          h('subject'),
        from_email:       h('from'),
        to_email:         h('to'),
        body:             body.slice(0, 5000),
        received_at:      new Date(parseInt(msg.data.internalDate)).toISOString(),
        already_imported: !!existing,
        work_product_id:  existing?.work_product_id || null,
      };
    }));

    res.json({ emails });
  } catch (err) {
    console.error('Gmail sync error:', err.message);
    if (err.code === 401 || err.status === 401)
      return res.status(401).json({ error: 'Gmail session expired. Please reconnect.' });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/gmail/assign', (req, res) => {
  const { work_product_id, gmail_message_id, subject, from_email, to_email, body, received_at } = req.body;
  if (!work_product_id || !gmail_message_id)
    return res.status(400).json({ error: 'work_product_id and gmail_message_id required' });

  const existing = db.prepare('SELECT * FROM emails WHERE gmail_message_id = ?').get(gmail_message_id);
  if (existing) return res.json({ email: existing, already_existed: true });

  const result = db.prepare(`
    INSERT INTO emails (work_product_id, subject, from_email, to_email, body, received_at, gmail_message_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(work_product_id, subject || '', from_email || '', to_email || '', body || '',
         received_at || new Date().toISOString(), gmail_message_id);
  db.prepare('UPDATE work_products SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(work_product_id);
  res.json({ email: db.prepare('SELECT * FROM emails WHERE id = ?').get(result.lastInsertRowid) });
});

app.delete('/api/gmail/disconnect', (req, res) => {
  db.prepare('DELETE FROM gmail_tokens WHERE id = 1').run();
  res.json({ success: true });
});

// ── Serve frontend ─────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✓ Work Product Manager running at http://localhost:${PORT}\n`);
});
