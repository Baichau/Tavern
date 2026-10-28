# Tavern

Chat with AI characters you create yourself, powered by local [Ollama](https://ollama.com) models and saved to a [Neon](https://neon.tech) Postgres database. No message limits, no accounts, no third-party AI service.

## Features

- **Create your own characters**: icon, name, tagline, first message, model, creativity and a color that tints their whole conversation.
- **Describe, don’t write prompts**: type a short idea such as “an elf who runs a tea shop”. Ollama expands it into full instructions for itself: background, voice, quirks, goals and example lines. The result is editable, and if you leave it empty it is written automatically when you save.
- **Streaming replies**: text appears as it is generated, with a Stop button.
- **Chat controls**: regenerate the last reply, delete it, or start a new chat (the character’s first message returns).
- **Everything persists in Neon**: characters and every conversation survive reloads and devices.
- **Any local model**: the model list is read from Ollama; pick a different model per character.
- **Three starter characters** are created on first run.
- **Responsive**: sidebar becomes a drawer on mobile.

## How it works

```
React (Vite) ──/api────────▶ Express ──▶ Neon Postgres
             └─/ollama────▶ Express ──▶ Ollama (streamed)
```

The database connection string stays on the server and never reaches the browser. The same server forwards chat requests to Ollama, so you don’t need to configure Ollama’s CORS settings.

## Setup

**Requirements:** Node.js 20+, Ollama running with at least one model, and a free Neon project.

1. Pull a model. For the tested Qwen setup: `ollama pull qwen2.5-coder:7b`
2. In the Neon dashboard open **Connect** and copy the connection string.
3. Install and configure:
   ```bash
   npm install
   cp .env.example .env     # then paste your DATABASE_URL
   ```
4. Start both the API and the app:
   ```bash
   npm run dev
   ```
5. Open http://localhost:5173. The tables are created automatically on first start.

### Production

```bash
npm run build
npm start        # serves the app and API on http://localhost:8787
```

## Configuration (`.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | none (required) | Neon connection string |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama address as seen from the server |
| `PORT` | `8787` | API/server port |

## Database

| Table | Columns |
| --- | --- |
| `bots` | `id`, `name`, `emoji`, `tagline`, `brief` (your short idea), `persona` (full instructions), `greeting`, `model`, `temp`, `hue`, `created_at` |
| `messages` | `id`, `bot_id` → `bots` (cascade delete), `role`, `content`, `created_at` |

## API

| Method | Route | Purpose |
| --- | --- | --- |
| GET / POST | `/api/bots` | List / create characters |
| PUT / DELETE | `/api/bots/:id` | Update / delete a character |
| GET / POST / DELETE | `/api/bots/:id/messages` | Read, add, or reset a chat |
| DELETE | `/api/messages/:id` | Delete one message |
| ANY | `/ollama/*` | Streamed pass-through to Ollama |

## Project structure

```
server/index.js     Express API, Neon schema, Ollama proxy
src/App.jsx         Sidebar, chat, streaming
src/BotDialog.jsx   Character editor and AI instruction writer
src/api.js          API client, Ollama streaming, prompts
src/styles.css      Design
```

## Troubleshooting

- **“Ollama not reachable”**: start Ollama, or set `OLLAMA_URL` if it runs elsewhere, then restart the API.
- **“No model found”**: run `ollama pull qwen2.5-coder:7b` and reload. Other installed Ollama models can be selected per character.
- **Database error on start**: check that `DATABASE_URL` is complete and includes `?sslmode=require`.

## Known limits and next steps

- There is no login: everyone using the same server shares the same characters. Add auth and an `owner_id` column before exposing it publicly.
- Only the last 40 messages are sent to the model.
- Ideas: character sharing, avatars, long-term memory summaries, multiple chats per character.
