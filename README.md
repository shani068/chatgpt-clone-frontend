# ChatGPT Frontend

The web app for a ChatGPT-style AI assistant. Visitors who are not signed in see a landing page. Signed-in users get a full chat interface: AI replies that appear word by word, saved conversation history, and personal settings.

This app is the only part users interact with. It works together with the Express API in [`chat_gpt_backend`](../chat_gpt_backend), which handles accounts, storage, and the AI model. The browser only ever talks to this app. Requests to `/api/*` are passed through to the backend behind the scenes.

---

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Scripts](#scripts)
- [Pages and routes](#pages-and-routes)
- [Project structure](#project-structure)
- [Development workflow](#development-workflow)
- [Current limitations](#current-limitations)
- [Troubleshooting](#troubleshooting)

---

## Features

**Accounts**
- Sign up and sign in with email and password, or with Google
- Sessions are kept in secure httpOnly cookies
- Private pages redirect to the login page when you are signed out. Login and register pages redirect home when you are signed in.

**Chat**
- AI replies stream in as they are generated
- Stop a reply partway through, regenerate it, or retry a failed one
- Edit an earlier message and get a new reply from that point
- Replies render GitHub-flavoured Markdown: tables, lists, and code blocks with syntax highlighting and a copy button
- Starter prompts on the welcome screen

**Conversations**
- Conversations are saved to the backend and appear in a sidebar, grouped by date
- Rename, pin, archive, and delete conversations (archived chats are hidden from the sidebar)
- Search conversations with `⌘K` / `Ctrl+K`

**Settings** (in a dialog, or full page at `/settings`)
- Light, dark, or system theme (dark is the default)
- What the Enter key does (send, or new line)
- Toggles for streaming, auto-scroll, and message actions
- A list of keyboard shortcuts

**Keyboard shortcuts**

| Action | Shortcut |
| --- | --- |
| Search conversations | `⌘/Ctrl + K` |
| New chat | `⌘/Ctrl + Shift + O` |
| Send message | `⌘/Ctrl + Enter` |
| Toggle sidebar | `⌘/Ctrl + B` |
| Open settings | `⌘/Ctrl + ,` |
| Focus the message box | `/` |
| Close a dialog or menu | `Esc` |

---

## How it works

```
Browser ──► Next.js app (localhost:3000)
              │
              ├── Pages and UI
              │
              └── /api/*  ── forwarded to ──►  Express backend (localhost:4000)
                                                ├── /api/auth/*           sign-in and sessions
                                                ├── /api/v1/conversations
                                                ├── /api/v1/messages
                                                └── /api/chat             streaming replies
```

- **Forwarding (`next.config.ts`).** Every request to `/api/*` is forwarded to `BACKEND_URL`. The browser only ever sees `localhost:3000`, so login cookies work without cross-site problems.
- **Route protection (`proxy.ts`).** Before serving `/c`, `/chat`, `/settings`, or `/dashboard`, the app asks the backend whether the session is valid. Having a cookie is not enough on its own.
- **Sending a message.** The first message in a new chat creates the conversation on the backend, and the URL changes to `/c/<id>`. After that, `lib/chat/stream-chat.ts` sends the newest message to `POST /api/chat` and shows the reply as it streams in. The backend keeps the full history.

---

## Tech stack

| Technology | Purpose |
| --- | --- |
| Next.js 16 (App Router) | Pages, routing, and the `/api` proxy |
| React 19 + TypeScript | UI |
| Tailwind CSS v4 | Styling and design tokens (all in `app/globals.css`) |
| Better Auth (client) | Sign-in, sign-up, and session state |
| Vercel AI SDK (`ai`) | Reads the streaming chat response |
| TanStack Query + Axios | Loads and updates conversations |
| Radix UI + lucide-react | Accessible dialogs, menus, and tooltips, plus icons |
| react-markdown, remark-gfm, rehype-highlight | Markdown and code highlighting in replies |
| Framer Motion | Animations |
| next-themes | Light and dark themes |
| React Hook Form + Zod | Login and registration forms |

---

## Getting started

### Prerequisites

- [Bun](https://bun.sh). This is the recommended package manager, and `bun.lock` is the lockfile.
- The **backend must be running**. Set it up by following the [backend README](../chat_gpt_backend/README.md). It needs PostgreSQL, an OpenAI key, and Google OAuth credentials.

### 1. Install dependencies

```bash
cd chat_gpt_project
bun install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

The default `BACKEND_URL=http://localhost:4000` works if the backend runs locally on its default port.

### 3. Start the app

```bash
bun run dev
```

Open http://localhost:3000. You will see the landing page. Create an account or sign in to start chatting.

### Connecting to the backend: checklist

| Where | Setting | Value (local) |
| --- | --- | --- |
| Frontend `.env.local` | `BACKEND_URL` | `http://localhost:4000` |
| Backend `.env` | `BETTER_AUTH_URL` | `http://localhost:3000` (this app's URL, **not** the backend's) |
| Google Cloud Console | Authorized redirect URI | `http://localhost:3000/api/auth/callback/google` |

---

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `BACKEND_URL` | Yes | `http://localhost:4000` | Where `/api/*` requests are forwarded. Only the server uses it; it is never sent to the browser. |
| `NEXT_PUBLIC_API_URL` | No | `http://localhost:3000` | Base URL for API calls from the browser. Keep it set to this app's own URL so cookies keep working. |

> Never put backend secrets such as `OPENAI_API_KEY` in this project. Any variable starting with `NEXT_PUBLIC_` is visible to everyone who opens the site.

---

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Start the dev server (webpack) |
| `bun run dev:turbo` | Start the dev server with Turbopack |
| `bun run dev:clean` | Delete the `.next` cache, then start the dev server |
| `bun run build` | Create a production build |
| `bun start` | Serve the production build |
| `bun run lint` | Check code with ESLint |

---

## Pages and routes

| Route | Who can see it | What it shows |
| --- | --- | --- |
| `/` | Everyone | The landing page if signed out; a new chat if signed in |
| `/c/[conversationId]` | Signed-in users | An existing conversation |
| `/login`, `/register` | Signed-out users | Email/password and Google sign-in |
| `/settings` | Signed-in users | The settings page |
| `/chat`, `/chat/[chatId]` | Signed-in users | Old links; they redirect to `/` or `/c/[id]` |
| `/dashboard` | Signed-in users | Old link; redirects to `/` |

---

## Project structure

Source files live at the project root; there is no `src/` folder. The import alias `@/*` points to the project root.

```
chat_gpt_project/
├── app/                      # Pages and layouts (Next.js App Router)
│   ├── page.tsx              # "/": landing page or chat home
│   ├── c/[conversationId]/   # A conversation
│   ├── (auth)/               # Login and register
│   ├── (dashboard)/          # Settings (plus the old /dashboard redirect)
│   ├── chat/                 # Old /chat routes (redirects only)
│   └── globals.css           # Design system: colours, type, spacing tokens
├── components/
│   ├── chat/                 # Chat screen: messages, composer, header, markdown, code blocks
│   ├── sidebar/              # Conversation list, search, user menu
│   ├── settings/             # Settings dialog and page
│   ├── marketing/            # Landing page sections
│   ├── features/auth/        # Login, register, and Google sign-in forms
│   ├── shared/               # Logo, theme toggle, toasts, empty/error/loading states
│   └── ui/                   # Basic building blocks: button, input, dialog, menu, tooltip
├── providers/
│   ├── app-providers.tsx     # Wraps the app in all providers (order matters)
│   ├── session-provider.tsx  # Current user and sign-in/out (Better Auth)
│   ├── chat-provider.tsx     # Conversations, sending messages, streaming
│   ├── preferences-provider.tsx  # User settings
│   └── query-provider.tsx    # TanStack Query
├── hooks/                    # Chat, history, auto-scroll, shortcuts, API helpers
├── lib/
│   ├── auth-client.ts        # Better Auth client and friendly error messages
│   ├── api.ts                # Axios instance (redirects to /login on 401)
│   └── chat/                 # Streaming, markdown, attachment, and local-storage helpers
├── constants/                # App name, routes, API paths, animation timings
├── types/                    # Shared TypeScript types
├── utils/                    # Small helpers (class names, dates, errors)
├── proxy.ts                  # Protects private routes
└── next.config.ts            # Forwards /api/* to the backend
```

---

## Development workflow

### Day to day

1. Start the backend (`bun run dev` in `chat_gpt_backend`).
2. Start this app (`bun run dev`).
3. Run `bun run lint` before committing. Prettier (with the Tailwind class-sorting plugin) handles formatting.

If the dev server behaves strangely after large changes, run `bun run dev:clean`.

### Conventions

- **Colours come from design tokens.** Use classes like `bg-card`, `text-muted-foreground`, and `border-border`, not raw hex values or Tailwind palette colours. Tokens are defined in `app/globals.css`.
- **Keep client components small.** Pages and layouts stay server components. `"use client"` goes on the interactive component that needs it.
- **Icon buttons need a `label`.** It becomes both the accessible name and the tooltip.
- **Use the route and API constants.** Import paths from `constants/routes.ts` instead of typing strings like `"/login"` by hand.
- **Never call the backend's address directly.** Always use relative `/api/...` paths so requests go through the proxy with cookies.

---

## Current limitations

Some features work only in the browser and are not yet connected to the backend:

- **File attachments.** Files can be picked and previewed (PNG, JPG, PDF, DOCX, CSV, JSON, and TXT; up to 5 files of 10 MB each). The upload is **simulated**, and the files are **not sent** to the AI. Only the message text is sent.
- **Settings.** Preferences are saved in the browser's `localStorage`, not to your account.
- **"Export data" and "Delete all conversations"** in Settings only affect conversations stored in the browser. They do **not** export or delete conversations saved on the server.
- **Message feedback.** Thumbs up and thumbs down are shown but not saved.

`PROJECT_STRUCTURE.md` was written for an earlier version that used a mock backend, and parts of it are out of date. Use this README as the current reference.

---

## Troubleshooting

| Problem | Likely cause |
| --- | --- |
| You are sent back to `/login` after signing in | The backend is not running, or `BACKEND_URL` is wrong. The route check in `proxy.ts` cannot reach the backend. |
| Sign-in fails or cookies are not set | The backend's `BETTER_AUTH_URL` must be `http://localhost:3000` (this app), not the backend's URL. |
| Google sign-in fails with `redirect_uri_mismatch` | Add `http://localhost:3000/api/auth/callback/google` to the Google OAuth client. |
| Replies never arrive or show an error | Check the backend logs. The most common causes are a missing or invalid `OPENAI_API_KEY`, or the database not being reachable. |
| Pages look broken after upgrading packages | Run `bun run dev:clean` to clear the Next.js cache. |

---

## License

No license file is included in this project.
