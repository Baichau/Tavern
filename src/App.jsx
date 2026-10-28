import { useEffect, useRef, useState } from 'react';
import { db, listModels, streamChat, sysPrompt } from './api.js';
import BotDialog from './BotDialog.jsx';

// *asterisks* become italic actions; everything else is plain text (safe by default).
const Fmt = ({ t }) =>
  t.split(/(\*[^*\n]+\*)/g).map((p, i) =>
    p.length > 2 && p.startsWith('*') && p.endsWith('*') ? <em key={i}>{p.slice(1, -1)}</em> : p
  );

export default function App() {
  const [bots, setBots] = useState([]);
  const [active, setActive] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [models, setModels] = useState([]);
  const [online, setOnline] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [input, setInput] = useState('');
  const [dlg, setDlg] = useState(null); // null | 'new' | bot
  const [open, setOpen] = useState(false);
  const ac = useRef(), end = useRef(), box = useRef();
  const bot = bots.find((b) => b.id === active);

  useEffect(() => {
    db.bots().then((b) => { setBots(b); setActive(b[0]?.id ?? null); }).catch((e) => setErr('Can’t reach the Tavern API: ' + e.message));
    listModels().then((m) => { setModels(m); setOnline(true); }).catch(() => setOnline(false));
  }, []);
  useEffect(() => {
    if (active) db.msgs(active).then(setMsgs).catch((e) => setErr(e.message));
    else setMsgs([]);
  }, [active]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs]);

  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { setErr(e.message); } };
  const pick = (id) => { ac.current?.abort(); setErr(''); setOpen(false); setActive(id); };

  // Streams a reply for `history`, then saves it to Neon.
  async function run(history) {
    const b = bot, model = b.model || models[0];
    if (!model) return setErr('No model found. Run “ollama pull llama3.2” and reload.');
    setErr(''); setBusy(true);
    ac.current = new AbortController();
    let out = '';
    setMsgs((m) => [...m, { id: 'tmp', role: 'assistant', content: '' }]);
    try {
      const messages = [{ role: 'system', content: sysPrompt(b) }, ...history.slice(-40)];
      for await (const t of streamChat({ model, temp: b.temp, messages }, ac.current.signal)) {
        out += t;
        setMsgs((m) => m.map((x) => (x.id === 'tmp' ? { ...x, content: out } : x)));
      }
    } catch (e) { if (e.name !== 'AbortError') setErr(e.message); }
    try {
      if (out) {
        const saved = await db.addMsg(b.id, 'assistant', out);
        setMsgs((m) => m.map((x) => (x.id === 'tmp' ? saved : x)));
      } else setMsgs((m) => m.filter((x) => x.id !== 'tmp'));
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  const submit = guard(async () => {
    if (busy) return ac.current?.abort();
    const text = input.trim();
    if (!text) return;
    setInput(''); if (box.current) box.current.style.height = 'auto';
    const next = [...msgs, await db.addMsg(bot.id, 'user', text)];
    setMsgs(next);
    run(next);
  });
  const regen = guard(async () => {
    await db.delMsg(msgs.at(-1).id);
    const next = msgs.slice(0, -1);
    setMsgs(next); run(next);
  });
  const delReply = guard(async () => { await db.delMsg(msgs.at(-1).id); setMsgs(msgs.slice(0, -1)); });
  const newChat = guard(async () => { ac.current?.abort(); setErr(''); setMsgs(await db.reset(bot.id)); });

  async function saveBot(f) {
    const s = await db.saveBot(f);
    setBots((bs) => (f.id ? bs.map((b) => (b.id === s.id ? s : b)) : [...bs, s]));
    setDlg(null);
    if (!f.id) pick(s.id);
    else if (s.id === active) db.msgs(s.id).then(setMsgs);
  }
  const delBot = guard(async (b) => {
    await db.delBot(b.id);
    const rest = bots.filter((x) => x.id !== b.id);
    setBots(rest); setDlg(null);
    if (active === b.id) setActive(rest[0]?.id ?? null);
  });

  return (
    <div className="app">
      <aside className={'side' + (open ? ' open' : '')}>
        <div className="brand">Tavern<small>Your characters, running on your machine</small></div>
        <button className="new" onClick={() => { setOpen(false); setDlg('new'); }}>+ Create a character</button>
        <div className="list">
          {bots.map((b) => (
            <button key={b.id} className={'bot' + (b.id === active ? ' on' : '')} style={{ '--h': b.hue }} onClick={() => pick(b.id)}>
              <span className="av">{b.emoji}</span>
              <span className="txt"><b>{b.name}</b><span className="t">{b.tagline || b.model}</span></span>
            </button>
          ))}
        </div>
        <div className="foot">
          <span className={'dot' + (online ? ' ok' : '')} />
          <span title={models.join(', ')}>
            {online === null ? 'Checking Ollama…' : online ? `Ollama · ${models.length === 1 ? models[0] : `${models.length} models`}` : 'Ollama not reachable'}
          </span>
        </div>
      </aside>

      <main className="main" style={{ '--h': bot?.hue ?? 250 }}>
        {bot ? (
          <>
            <div className="head" style={{ '--h': bot.hue }}>
              <button className="ico menu" onClick={() => setOpen(!open)} aria-label="Characters">☰</button>
              <span className="av">{bot.emoji}</span>
              <div className="txt"><b>{bot.name}</b><small>{[bot.tagline, bot.model || models[0]].filter(Boolean).join(' · ')}</small></div>
              <button className="ico" onClick={newChat}>New chat</button>
              <button className="ico" onClick={() => setDlg(bot)}>Edit</button>
            </div>
            <div className="msgs">
              {msgs.map((m, i) => {
                const ai = m.role === 'assistant', last = i === msgs.length - 1;
                return (
                  <div key={m.id}>
                    <div className={'row ' + (ai ? 'ai' : 'me')}>
                      {ai && <span className="av sm">{bot.emoji}</span>}
                      <div className={'bub' + (busy && last && ai ? ' typing' : '')}><Fmt t={m.content} /></div>
                    </div>
                    {ai && last && !busy && msgs.length > 1 && (
                      <div className="acts"><button onClick={regen}>↻ Regenerate</button><button onClick={delReply}>Delete reply</button></div>
                    )}
                  </div>
                );
              })}
              <div ref={end} />
            </div>
            {err && <div className="err bar" role="alert">{err}</div>}
            <div className="comp">
              <textarea
                ref={box} rows={1} value={input}
                placeholder="Message your character…  (Enter to send, Shift+Enter for a new line)"
                onChange={(e) => setInput(e.target.value)}
                onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'; }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
              />
              <button className={'send' + (busy ? ' stop' : '')} onClick={submit}>{busy ? 'Stop' : 'Send'}</button>
            </div>
          </>
        ) : (
          <div className="empty">
            <p>{err || 'No characters yet.'}</p>
            <button className="new" onClick={() => setDlg('new')}>+ Create a character</button>
          </div>
        )}
      </main>

      {dlg && <BotDialog bot={dlg === 'new' ? null : dlg} models={models} onSave={saveBot} onDelete={delBot} onClose={() => setDlg(null)} />}
    </div>
  );
}
