# TriBoard AI: AI-Powered Collaborative Workspace

**Write, plan and sketch together.** TriBoard AI is a full-stack workspace where each canvas has four views (**Notes, Document, Table and Draw**). Canvases sync in real time across users, can be shared by email, and include an AI assistant that generates content in the right format for each view.

**Live demo:** https://gather-workspace-six.vercel.app

## Features

- **Four views per canvas**
  - **Notes:** quick thoughts and reminders
  - **Document:** longer text
  - **Table:** editable spreadsheet (add or delete rows and columns, edit headers and cells)
  - **Draw:** sketching board with select, pen and connect tools for diagrams
- **Real-time sync:** changes save to Cloud Firestore and appear for all collaborators instantly through `onSnapshot` listeners
- **Google sign-in** with Firebase Authentication
- **Sharing:** invite collaborators by email. Canvases stay private until shared, and shared canvases appear in a separate section
- **AI assistant ("Ask AI")** that knows which view it's writing for:
  - Document → plain structured text
  - Table → JSON `{columns, rows}` rendered straight into the table editor
  - Draw → JSON `{nodes, edges}` rendered as a diagram
- **Multi-provider LLM fallback:** tries **Gemini** first and falls back to **Groq (GPT-OSS-120B)** if a provider fails or isn't configured
- **Guardrails:** prompts forbid inventing personal data (names, emails, dates, amounts). Template requests return empty structures to fill in
- **Per-canvas analytics:** edits today, AI prompts today, word count, number of collaborators, save status, and a 7-day activity history

## Architecture

```
React 19 + Vite (client, Vercel)
 ├── Firebase Auth ........ Google sign-in
 ├── Cloud Firestore ...... canvases, sharing, activity history (real-time listeners)
 └── REST: POST /api/ai/generate
        │
Node.js + Express (server)
 └── ai.js ── Gemini API  ──(fallback)──►  Groq API
```

## Tech stack

| Layer | Technologies |
|---|---|
| Frontend | React 19, Vite, CSS |
| Auth & database | Firebase Authentication, Cloud Firestore |
| Backend | Node.js, Express, CORS |
| AI | Google Gemini (`@google/genai`), Groq (OpenAI-compatible API) |
| Hosting | Vercel (client) |

## Project structure

```
client/
  src/
    App.jsx            # canvases, tabs, sharing, AI panel, Firestore sync
    DrawBoard.jsx      # drawing / diagram board
    TableEditor.jsx    # spreadsheet editor
    AnalyticsPanel.jsx # per-canvas activity analytics
    firebase.js        # Firebase initialisation
server/
  server.js            # Express app
  ai.js                # /api/ai/generate: prompts, model catalog, fallback
```

## Run locally

**Prerequisites:** Node.js 18+, a Firebase project (Authentication with Google provider enabled, plus Firestore), and a Gemini and/or Groq API key.

### 1. Server
```bash
cd server
npm install
```
Create `server/.env`:
```
GEMINI_API_KEY=your_gemini_key
GROQ_API_KEY=your_groq_key      # optional, used as fallback
PORT=5000
```
```bash
npm run dev
```

### 2. Client
```bash
cd client
npm install
```
Create `client/.env`:
```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MEASUREMENT_ID=
```
```bash
npm run dev     # http://localhost:5173
```

> Never commit `.env` files. They're listed in `.gitignore`.

## Deployment

- **Client:** Vercel (root directory `client`, build `npm run build`, output `dist`), with the `VITE_FIREBASE_*` variables set in the Vercel project settings.
- **Server:** any Node host (e.g. Render), with `GEMINI_API_KEY` / `GROQ_API_KEY` set as environment variables.
- Add your Vercel domain under **Firebase → Authentication → Authorized domains**.

## Roadmap

- Live cursors and presence indicators
- Export canvases to PDF and CSV
- Version history per canvas

## Author

**Divya Singh** · [GitHub](https://github.com/DivyaSingh0111) · [LinkedIn](https://www.linkedin.com/in/divya-singh-987b6b20b)

