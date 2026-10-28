import { useEffect, useRef, useState } from 'react';
import { streamChat, EXPAND } from './api.js';

export default function BotDialog({ bot, models, onSave, onDelete, onClose }) {
  const [f, setF] = useState(
    bot || { name: '', emoji: '🧙', tagline: '', brief: '', persona: '', greeting: '', model: models[0] || '', temp: 0.8, hue: Math.floor(Math.random() * 360) }
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ref = useRef(), ac = useRef();
  useEffect(() => { ref.current.showModal(); }, []);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const bind = (k) => ({ value: f[k], onChange: (e) => set(k, e.target.value) });
  const close = () => { ac.current?.abort(); onClose(); };

  // Ollama turns the short idea into full instructions for itself.
  async function expand() {
    const model = f.model || models[0];
    if (!f.brief.trim()) { setErr('Describe your character first, even in a few words.'); return null; }
    if (!model) { setErr('Pick a model first.'); return null; }
    setBusy(true); setErr('');
    ac.current = new AbortController();
    let out = '';
    try {
      for await (const t of streamChat({ model, temp: 0.9, messages: EXPAND(f.brief, f.name) }, ac.current.signal)) {
        out += t; set('persona', out);
      }
    } catch (e) { if (e.name !== 'AbortError') setErr(e.message); }
    setBusy(false);
    return out;
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    let persona = f.persona;
    if (!persona.trim() && f.brief.trim()) persona = (await expand()) || '';
    try { await onSave({ ...f, persona, model: f.model || models[0] || '' }); }
    catch (e2) { setErr(e2.message); }
  }

  return (
    <dialog ref={ref} className="dlg" onCancel={close} onClose={close}>
      <form onSubmit={submit}>
        <h2>{bot ? 'Edit ' + bot.name : 'Create a character'}</h2>
        <div className="two">
          <label>Icon<input {...bind('emoji')} maxLength={4} className="emoji" /></label>
          <label>Name<input {...bind('name')} required placeholder="e.g. Captain Mara" /></label>
        </div>
        <label>Tagline<input {...bind('tagline')} placeholder="Shown under the name" /></label>
        <label>
          Describe your character
          <textarea {...bind('brief')} style={{ minHeight: 60 }} placeholder="Just the idea, e.g. “an elf who runs a tea shop”" />
        </label>
        <div className="gen">
          <button type="button" className="spark" onClick={busy ? () => ac.current.abort() : expand}>
            {busy ? 'Stop writing' : '✨ Write full instructions'}
          </button>
          <span className="hint">The model decides what “an elf” means: background, voice, quirks.</span>
        </div>
        <label>
          Instructions the model wrote for itself (you can edit them)
          <textarea {...bind('persona')} placeholder="Leave empty and they are written when you save." />
        </label>
        <label>First message<textarea {...bind('greeting')} style={{ minHeight: 56 }} placeholder="What the character says to start the chat" /></label>
        <label>Model
          <input {...bind('model')} list="models" placeholder="e.g. llama3.2" />
          <datalist id="models">{models.map((m) => <option key={m} value={m} />)}</datalist>
        </label>
        <label>Creativity: {(+f.temp).toFixed(2)}
          <input type="range" min="0" max="1.5" step="0.05" value={f.temp} onChange={(e) => set('temp', +e.target.value)} />
        </label>
        <label>Color
          <input type="range" min="0" max="359" value={f.hue} onChange={(e) => set('hue', +e.target.value)} style={{ accentColor: `hsl(${f.hue} 70% 65%)` }} />
        </label>
        {err && <div className="err">{err}</div>}
        <div className="btns">
          {bot && <button type="button" className="del" onClick={() => confirm(`Delete ${bot.name} and its chat?`) && onDelete(bot)}>Delete</button>}
          <button type="button" onClick={close}>Cancel</button>
          <button className="pri" disabled={busy}>Save character</button>
        </div>
      </form>
    </dialog>
  );
}
