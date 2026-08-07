# AQLI WhatsApp AI Chatbot — Setup Guide

## 1. Install dependencies

```bash
npm install
```

## 2. Configure environment variables

Copy the example file:

```bash
cp .env.example .env.local
```

Fill in all values:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project → Settings → API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase project → Settings → API Keys |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Legacy fallback if your project still uses anon keys |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project → Settings → API (secret) |
| `SUPABASE_PROJECT_REF` | Supabase project reference, used by `npm run migrate` |
| `SUPABASE_ACCESS_TOKEN` | Supabase account token, used by `npm run migrate` |
| `WHATSAPP_VERIFY_TOKEN` | Any random string you choose |
| `WHATSAPP_ACCESS_TOKEN` | Meta Developer → WhatsApp → API Setup |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta Developer → WhatsApp → API Setup |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Meta Developer → WhatsApp → Business Account |
| `OPENROUTER_API_KEY` | https://openrouter.ai/keys |
| `OPENROUTER_MODEL` | e.g. `meta-llama/llama-3.1-8b-instruct:free` |
| `EMBEDDING_PROVIDER` | `huggingface` by default, or `openai` |
| `HUGGINGFACE_TOKEN` | Optional, for higher HuggingFace limits |
| `OPENAI_API_KEY` | Optional, only when `EMBEDDING_PROVIDER=openai` |
| `APP_URL` | Your deployed app URL |

## 3. Set up Supabase

1. Go to your Supabase project → SQL Editor
2. Paste and run the contents of `supabase/schema.sql`
3. Enable Realtime on the `messages` and `conversations` tables:
   - Go to Supabase → Database → Replication
   - Enable `messages` and `conversations`

## 4. Create an admin user

In Supabase → Authentication → Users → "Invite user" or "Add user":
- Enter your email and password
- This will be your dashboard login

## 5. Run locally

```bash
npm run dev
```

Visit http://localhost:3000 → redirects to `/dashboard` → login.

Useful checks:

```bash
npm run lint
npm run build
```

## 6. Deploy to Vercel

```bash
npx vercel
```

Set all environment variables in Vercel project settings → Environment Variables.

## 7. Configure Meta WhatsApp Webhook

1. Go to [Meta Developer Dashboard](https://developers.facebook.com)
2. Select your app → WhatsApp → Configuration
3. Set Callback URL: `https://your-app.vercel.app/api/webhook`
4. Set Verify Token: same as `WHATSAPP_VERIFY_TOKEN` in your env
5. Click "Verify and Save"
6. Under Webhook Fields → subscribe to `messages`
7. Send a test WhatsApp message to your number

## Folder Structure

```
app/
  api/
    webhook/          ← Meta webhook (GET verify, POST incoming)
    conversations/    ← List, update, send messages
    knowledge/        ← Upload, list, delete, reprocess
  auth/login/         ← Admin login page
  dashboard/          ← Conversation dashboard
  dashboard/knowledge ← Knowledge base manager
components/
  dashboard/
    ConversationDashboard.tsx  ← Main chat UI with realtime
    KnowledgeManager.tsx       ← Upload + manage knowledge
lib/
  supabase/           ← Client, server, middleware helpers
  whatsapp.ts         ← Send message + verify token
  embeddings.ts       ← OpenRouter/OpenAI embedding generation
  chunking.ts         ← Text chunking + file extraction
  rag.ts              ← Vector search
  ai.ts               ← OpenRouter chat completion
types/index.ts        ← TypeScript types
supabase/schema.sql   ← Full DB schema (run in Supabase SQL editor)
```

## How the RAG flow works

```
User sends WhatsApp message
  → POST /api/webhook
  → Store user message in Supabase
  → Generate embedding for user question
  → Search knowledge_chunks via pgvector similarity
  → Build prompt: system + retrieved context + chat history + user message
  → Call OpenRouter for AI response
  → Send reply via Meta WhatsApp Cloud API
  → Store AI response in Supabase
  → Dashboard updates in realtime via Supabase Realtime
```

## Adding knowledge

1. Go to `/dashboard/knowledge`
2. Paste text or upload a PDF/DOCX/TXT file
3. Click "Upload & Embed" — the app chunks the text and generates embeddings
4. The chatbot automatically uses new knowledge in future replies

## Human handoff

- Click the mode badge in the chat header to switch a conversation to "Human Mode"
- In Human Mode, the AI stops auto-replying
- Type and send messages manually from the dashboard
- Switch back to "AI Mode" to re-enable auto-replies
