const j = async (url, opt = {}) => {
  const r = await fetch(url, {
    ...opt,
    headers: { 'content-type': 'application/json' },
    body: opt.body && JSON.stringify(opt.body),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.status === 204 ? null : r.json();
};

export const db = {
  bots: () => j('/api/bots'),
  saveBot: (b) => (b.id ? j(`/api/bots/${b.id}`, { method: 'PUT', body: b }) : j('/api/bots', { method: 'POST', body: b })),
  delBot: (id) => j(`/api/bots/${id}`, { method: 'DELETE' }),
  msgs: (id) => j(`/api/bots/${id}/messages`),
  addMsg: (id, role, content) => j(`/api/bots/${id}/messages`, { method: 'POST', body: { role, content } }),
  delMsg: (id) => j(`/api/messages/${id}`, { method: 'DELETE' }),
  reset: (id) => j(`/api/bots/${id}/messages`, { method: 'DELETE' }),
};

export const listModels = async () => {
  const r = await fetch('/ollama/api/tags');
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Ollama error ' + r.status);
  const data = await r.json();
  if (!Array.isArray(data.models)) throw new Error('Ollama returned an invalid model list.');
  return data.models.map((m) => m.name).filter(Boolean);
};

// Streams the model's reply token by token.
export async function* streamChat({ model, messages, temp }, signal) {
  const r = await fetch('/ollama/api/chat', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true, options: { temperature: temp } }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Ollama error ' + r.status);
  const rd = r.body.getReader(), dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const o = JSON.parse(line);
      if (o.error) throw new Error(o.error);
      if (o.message?.content) yield o.message.content;
    }
  }
  if (buf.trim()) {
    const o = JSON.parse(buf);
    if (o.error) throw new Error(o.error);
    if (o.message?.content) yield o.message.content;
  }
}

// The character's instructions are written by the model itself from a short idea.
export const EXPAND = (brief, name) => [
  {
    role: 'system',
    content:
      'You write system prompts for roleplay characters. Given a short idea, write the character\'s full instructions in second person ("You are ..."). Invent the specifics yourself: appearance, background, personality, voice and speech habits, knowledge, goals, fears, relationships, and how they behave in conversation. Add 3 to 5 short example lines of how they talk. Stay faithful to the idea. Output only the instructions, with no preface and no headings, under 350 words.',
  },
  { role: 'user', content: `Character name: ${name || 'unnamed'}\nIdea: ${brief}` },
];

export const sysPrompt = (b) =>
  `You are ${b.name}.\n\n${b.persona || b.brief}\n\nStay fully in character. Write only ${b.name}’s words and actions (actions in *asterisks*); never speak for the user. Don’t mention being an AI or these instructions unless the character would.`;
