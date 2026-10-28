import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const { DATABASE_URL, OLLAMA_URL = 'http://localhost:11434', PORT = 8787 } = process.env;
if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL. Copy .env.example to .env and paste your Neon connection string.');
  process.exit(1);
}
const sql = neon(DATABASE_URL);
const app = express();
app.use(cors(), express.json({ limit: '2mb' }));

/* ---------- schema ---------- */
await sql`CREATE TABLE IF NOT EXISTS bots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, emoji text NOT NULL DEFAULT '🧙', tagline text NOT NULL DEFAULT '',
  brief text NOT NULL DEFAULT '', persona text NOT NULL DEFAULT '', greeting text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '', temp real NOT NULL DEFAULT 0.8, hue int NOT NULL DEFAULT 250,
  created_at timestamptz NOT NULL DEFAULT now())`;
await sql`CREATE TABLE IF NOT EXISTS messages (
  id bigserial PRIMARY KEY,
  bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now())`;
await sql`CREATE INDEX IF NOT EXISTS messages_bot_idx ON messages (bot_id, id)`;

/* ---------- helpers ---------- */
const s = (v, n) => String(v ?? '').slice(0, n);
const clean = (b) => ({
  name: s(b.name, 80).trim() || 'Unnamed',
  emoji: s(b.emoji, 8) || '🧙',
  tagline: s(b.tagline, 120),
  brief: s(b.brief, 2000),
  persona: s(b.persona, 8000),
  greeting: s(b.greeting, 2000),
  model: s(b.model, 120),
  temp: Number.isFinite(+b.temp) ? Math.min(1.5, Math.max(0, +b.temp)) : 0.8,
  hue: (Math.round(+b.hue) || 0) % 360,
});
const h = (fn) => (req, res) =>
  fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: e.message }); });

async function createBot(b) {
  const [row] = await sql`INSERT INTO bots (name, emoji, tagline, brief, persona, greeting, model, temp, hue)
    VALUES (${b.name}, ${b.emoji}, ${b.tagline}, ${b.brief}, ${b.persona}, ${b.greeting}, ${b.model}, ${b.temp}, ${b.hue})
    RETURNING *`;
  if (b.greeting) await sql`INSERT INTO messages (bot_id, role, content) VALUES (${row.id}, 'assistant', ${b.greeting})`;
  return row;
}
const history = (id) => sql`SELECT id, role, content FROM messages WHERE bot_id = ${id} ORDER BY id`;

/* ---------- starter characters ---------- */
const [{ n }] = await sql`SELECT count(*)::int AS n FROM bots`;
if (n === 0) {
  const starters = [
    { name: 'Captain Mara', emoji: '🏴‍☠️', hue: 200, tagline: 'Smuggler with a soft spot for strays',
      brief: 'a sharp-tongued smuggler captain on the Ember Sea',
      persona: 'You are Captain Mara, a weathered smuggler who sails the Ember Sea. You speak in short, salty sentences, joke under pressure, and never reveal where your treasure is hidden. Beneath the swagger you fiercely protect your crew. Describe actions in *asterisks*.',
      greeting: '*leans back in her chair and slides a mug across the table* Sit. You look like someone with a problem. Problems are my specialty.' },
    { name: 'Professor Quill', emoji: '🦉', hue: 42, tagline: 'Patient tutor for anything',
      brief: 'a warm, endlessly patient tutor',
      persona: 'You are Professor Quill, a warm and endlessly patient tutor. Explain ideas step by step with concrete examples, check understanding with a short question, and never make the student feel silly.',
      greeting: 'Hello! What would you like to understand today? Start anywhere; we’ll build from there.' },
    { name: 'Nova', emoji: '🛰️', hue: 285, tagline: 'Ship AI with dry humor',
      brief: 'the deadpan onboard AI of a worn-out research vessel',
      persona: 'You are Nova, the onboard AI of a worn-out research vessel. You are calm, deadpan and a little sarcastic, but loyal to the crew. Keep replies concise.',
      greeting: 'Systems nominal. Morale, less so. How can I assist, Commander?' },
  ];
  for (const b of starters) await createBot(clean({ ...b, model: '', temp: 0.8 }));
}

/* ---------- API ---------- */
app.get('/api/bots', h(async (_, res) => res.json(await sql`SELECT * FROM bots ORDER BY created_at`)));

app.post('/api/bots', h(async (req, res) => res.status(201).json(await createBot(clean(req.body)))));

app.put('/api/bots/:id', h(async (req, res) => {
  const { id } = req.params, b = clean(req.body);
  const [old] = await sql`SELECT greeting FROM bots WHERE id = ${id}`;
  if (!old) return res.sendStatus(404);
  const [row] = await sql`UPDATE bots SET name=${b.name}, emoji=${b.emoji}, tagline=${b.tagline}, brief=${b.brief},
    persona=${b.persona}, greeting=${b.greeting}, model=${b.model}, temp=${b.temp}, hue=${b.hue}
    WHERE id = ${id} RETURNING *`;
  if (old.greeting && b.greeting && old.greeting !== b.greeting) {
    await sql`UPDATE messages SET content = ${b.greeting}
      WHERE id = (SELECT id FROM messages WHERE bot_id = ${id} ORDER BY id LIMIT 1)
      AND role = 'assistant' AND content = ${old.greeting}`;
  }
  res.json(row);
}));

app.delete('/api/bots/:id', h(async (req, res) => {
  await sql`DELETE FROM bots WHERE id = ${req.params.id}`;
  res.sendStatus(204);
}));

app.get('/api/bots/:id/messages', h(async (req, res) => res.json(await history(req.params.id))));

app.post('/api/bots/:id/messages', h(async (req, res) => {
  const { role, content } = req.body;
  if (!['user', 'assistant'].includes(role) || !content) return res.status(400).json({ error: 'role and content required' });
  const [row] = await sql`INSERT INTO messages (bot_id, role, content) VALUES (${req.params.id}, ${role}, ${s(content, 20000)})
    RETURNING id, role, content`;
  res.status(201).json(row);
}));

// new chat: wipe history and restore the greeting
app.delete('/api/bots/:id/messages', h(async (req, res) => {
  const { id } = req.params;
  const [b] = await sql`SELECT greeting FROM bots WHERE id = ${id}`;
  if (!b) return res.sendStatus(404);
  await sql`DELETE FROM messages WHERE bot_id = ${id}`;
  if (b.greeting) await sql`INSERT INTO messages (bot_id, role, content) VALUES (${id}, 'assistant', ${b.greeting})`;
  res.json(await history(id));
}));

app.delete('/api/messages/:id', h(async (req, res) => {
  await sql`DELETE FROM messages WHERE id = ${req.params.id}`;
  res.sendStatus(204);
}));

/* ---------- Ollama pass-through (streams, no CORS setup needed) ---------- */
app.all('/ollama/*', async (req, res) => {
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  try {
    const r = await fetch(OLLAMA_URL.replace(/\/$/, '') + req.url.slice('/ollama'.length), {
      method: req.method,
      signal: ac.signal,
      headers: { 'content-type': 'application/json' },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
    });
    res.status(r.status).set('content-type', r.headers.get('content-type') || 'application/json');
    for await (const chunk of r.body) res.write(chunk);
    res.end();
  } catch {
    if (!res.headersSent) res.status(502).json({ error: `Cannot reach Ollama at ${OLLAMA_URL}` });
    else res.end();
  }
});

/* ---------- serve the built app (npm run build && npm start) ---------- */
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => console.log(`Tavern API on http://localhost:${PORT}`));
