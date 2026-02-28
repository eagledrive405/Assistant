require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

const app = express();
const db = new Database(path.join(__dirname, 'workproducts.db'));
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
`);

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
        content: `Summarize this work product for a quick status overview:

Title: ${product.title}
Status: ${product.status}
Description: ${product.description || 'None'}

Emails:
${emailBlock}

Notes:
${notesBlock}

Provide:
1. A 2-3 sentence summary of the task and its current state
2. Key action items or next steps (bullet points)
3. Any risks, blockers, or urgent matters mentioned
4. Overall assessment

Be concise and actionable.`
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

// ── Serve frontend ─────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✓ Work Product Manager running at http://localhost:${PORT}\n`);
});
