# ChatGPT Frontend

The web app for a ChatGPT-style AI assistant. Visitors who are not signed in see a landing page. Signed-in users get a full chat interface: AI replies that appear word by word, saved conversation history, image and PDF attachments the assistant can read, and personal settings.

This app is the only part users interact with. It works together with the Express API in [`chat_gpt_backend`](../chat_gpt_backend), which handles accounts, storage, file processing, and the AI model. The browser only ever talks to this app. Requests to `/api/*` are passed through to the backend behind the scenes.

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
- If the AI provider fails (bad key, quota, outage), the reply shows the server's error message instead of staying empty
- Replies render GitHub-flavoured Markdown: tables, lists, and code blocks with syntax highlighting and a copy button
- Starter prompts on the welcome screen

**Attachments**
- Add files with the paperclip button, by dragging them onto the message box, or by pasting them (for example a screenshot)
- **Images** (PNG, JPG/JPEG, WebP, GIF; up to 5 MB each) are sent to the AI, so you can ask about them. You can send an image without any text.
- **PDFs** (up to 10 MB each) are indexed by the backend. Later questions in that conversation are answered from the PDF's content. A message with a PDF still needs text.
- Up to 5 files per message. Each file shows upload progress, and failed uploads are marked on their chip.
- Sent images appear as thumbnails that open full size in a new tab. Images and PDFs still appear on their messages after a reload.

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
                                                ├── /api/v1/images        image upload and download
                                                ├── /api/v1/documents     PDF upload (indexed for RAG)
                                                └── /api/chat             streaming replies
```

- **Forwarding (`next.config.ts`).** Every request to `/api/*` is forwarded to `BACKEND_URL`. The browser only ever sees `localhost:3000`, so login cookies work without cross-site problems.
- **Route protection (`proxy.ts`).** Before serving `/c`, `/chat`, `/settings`, or `/dashboard`, the app asks the backend whether the session is valid. Having a cookie is not enough on its own.
- **Loading data.** `providers/chat-provider.tsx` loads the conversation list with TanStack Query (`hooks/useFetch.ts`) and changes it with the mutation helpers in `hooks/useApi.ts`. All of them use the Axios instance in `lib/api.ts`. Opening a conversation loads it with `GET /api/v1/conversations/:id` and its messages with `GET /api/v1/messages?conversationId=<id>`.
- **Sending a message.** The first message in a new chat creates the conversation on the backend, and the URL changes to `/c/<id>`. After that, `lib/chat/stream-chat.ts` sends **only the newest message** to `POST /api/chat`, using the AI SDK's `DefaultChatTransport`, and shows the reply with `readUIMessageStream`. The backend keeps the full history.
- **Stream errors.** The stream is read with `terminateOnError: true`. If the server sends an `error` part, it is thrown as an error and the assistant message shows that text with a retry option.

### Attachment flow

1. `lib/chat/attachments.ts` checks each file's extension, size, and the per-message limit, and creates a local preview URL for images.
2. As soon as a file is added, it is uploaded with Axios (`postForm`), and the progress is shown on its chip:
   - images → `lib/chat/upload-image.ts` → `POST /api/v1/images` → `imageId`
   - PDFs → `lib/chat/upload-document.ts` → `POST /api/v1/documents` → `documentId`
3. Sending is disabled while any upload is in progress. Only files that uploaded successfully are sent.
4. `toUiMessage()` in `lib/chat/stream-chat.ts` turns each uploaded file into a message part that contains only its ID (`data-image` or `data-document`) plus its name, size, and type. A message with only images has no empty text part.
5. When a conversation loads, `attachmentsFromStoredParts()` in `lib/chat/chat-utils.ts` rebuilds the attachments from these saved parts. Images are shown from `/api/v1/images/:id`. That path is same-origin and goes through the proxy, so the session cookie authorises the `<img>` request.

---

## Tech stack

| Technology | Purpose |
| --- | --- |
| Next.js 16 (App Router) | Pages, routing, and the `/api` proxy |
| React 19 + TypeScript | UI |
| Tailwind CSS v4 | Styling and design tokens (all in `app/globals.css`) |
| Better Auth (client) | Sign-in, sign-up, and session state |
| Vercel AI SDK 7 (`ai`) | Sends chat requests and reads the streaming reply |
| TanStack Query + Axios | Loads and updates conversations, and uploads files with progress |
| Radix UI + lucide-react | Accessible dialogs, menus, and tooltips, plus icons |
| react-markdown, remark-gfm, rehype-highlight | Markdown and code highlighting in replies |
| Framer Motion | Animations |
| next-themes | Light and dark themes |
| React Hook Form + Zod | Login and registration forms |

> `@ai-sdk/openai` is listed in `package.json` but is not imported anywhere in the frontend. All model calls happen on the backend.

---

## Getting started

### Prerequisites

- [Bun](https://bun.sh). This is the recommended package manager, and `bun.lock` is the lockfile.
- The **backend must be running**. Set it up by following the [backend README](../chat_gpt_backend/README.md). It needs PostgreSQL, an OpenAI key, and Google OAuth credentials. PDF attachments also need Qdrant (`docker compose up -d` in the backend folder).

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
| `BACKEND_URL` | Yes | `http://localhost:4000` | Where `/api/*` requests are forwarded (`next.config.ts`), and where `proxy.ts` checks the session. Only the server uses it; it is never sent to the browser. |
| `NEXT_PUBLIC_API_URL` | No | `http://localhost:3000` | Base URL for Axios and the chat stream in the browser. Keep it set to this app's own URL so cookies keep working. It is not in `.env.example`. |

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

Source files live at the project root; there is no `src/` folder. The import alias `@/*` points to the project root. A file-by-file map is in [`PROJECT_STRUCTURE.md`](PROJECT_STRUCTURE.md).

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
│   ├── chat/                 # Chat screen: messages, composer, attachments, header, markdown, code blocks
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
├── hooks/                    # Chat, history, auto-scroll, shortcuts, useFetch/useApi (TanStack Query)
├── lib/
│   ├── auth-client.ts        # Better Auth client and friendly error messages
│   ├── api.ts                # Axios instance (redirects to /login on 401)
│   └── chat/
│       ├── stream-chat.ts    # POST /api/chat, UI message parts, stream reading
│       ├── upload-image.ts   # POST /api/v1/images
│       ├── upload-document.ts  # POST /api/v1/documents
│       ├── attachments.ts    # File type/size checks and preview URLs
│       ├── chat-utils.ts     # API → UI mapping (incl. saved attachments), titles, dates
│       ├── markdown.ts       # Code highlighting languages
│       └── mock-chat-service.ts  # Now only browser storage: preferences, export/clear
├── constants/                # App name, routes, API paths, animation timings
├── types/                    # Shared TypeScript types (file.ts: attachments and part payloads)
├── utils/                    # Small helpers (class names, dates, errors)
├── proxy.ts                  # Protects private routes
└── next.config.ts            # Forwards /api/* to the backend
```

---

## Development workflow

### Day to day

1. Start the backend (`bun run dev` in `chat_gpt_backend`) and Qdrant (`docker compose up -d`) if you are working on PDFs.
2. Start this app (`bun run dev`).
3. Run `bun run lint` before committing. Prettier (with the Tailwind class-sorting plugin) handles formatting.

If the dev server behaves strangely after large changes, run `bun run dev:clean`.

### Conventions

- **Colours come from design tokens.** Use classes like `bg-card`, `text-muted-foreground`, and `border-border`, not raw hex values or Tailwind palette colours. Tokens are defined in `app/globals.css`.
- **Keep client components small.** Pages and layouts stay server components. `"use client"` goes on the interactive component that needs it.
- **Icon buttons need a `label`.** It becomes both the accessible name and the tooltip.
- **Use the route and API constants.** Import paths from `constants/routes.ts` (`ROUTES`, `CHAT_API`, `IMAGES_API`, `DOCUMENTS_API`, `imageRoute()`, …) instead of typing strings like `"/login"` by hand.
- **Never call the backend's address directly.** Always use relative `/api/...` paths so requests go through the proxy with cookies.
- **Attachments are sent as IDs, never as file contents.** Upload first, then send the returned ID in a `data-image` / `data-document` part. The part formats are `ImagePartData` and `DocumentPartData` in `types/file.ts`, and they must match the backend's checks in `chat.validator.ts`.
- **Keep upload limits in sync.** `MAX_IMAGE_BYTES` (5 MB) and the PDF limit `MAX_ATTACHMENT_BYTES` (10 MB) in `types/file.ts` copy the backend's limits. If you change one side, change the other.

---

## Current limitations

Some features work only in the browser and are not yet connected to the backend:

- **Settings.** Preferences are saved in the browser's `localStorage`, not to your account.
- **"Export data" and "Delete all conversations"** in Settings only affect conversations stored in the browser. They do **not** export or delete conversations saved on the server.
- **Message feedback.** Thumbs up and thumbs down are shown but not saved.

Known gaps in chat and attachments:

- **Regenerate and edit don't replace the earlier message on the server.** Both create a new message ID, and only that newest message is sent. The backend adds it to the saved history, so the original question and its reply stay in the model's context. After a reload, both versions appear in the conversation.
- **Removing an attachment chip does not delete the upload.** The file is already stored on the backend, and there is no delete endpoint.
- **Upload errors don't explain the cause.** A failed upload is labelled only "Upload failed". The backend's reason, such as "File is too large" or an unsupported type, is not shown.
- **Only PDFs and images.** Other file types (DOCX, TXT, CSV, JSON, …) are rejected when you add them.

---

## Troubleshooting

| Problem | Likely cause |
| --- | --- |
| You are sent back to `/login` after signing in | The backend is not running, or `BACKEND_URL` is wrong. The route check in `proxy.ts` cannot reach the backend. |
| Sign-in fails or cookies are not set | The backend's `BETTER_AUTH_URL` must be `http://localhost:3000` (this app), not the backend's URL. |
| Google sign-in fails with `redirect_uri_mismatch` | Add `http://localhost:3000/api/auth/callback/google` to the Google OAuth client. |
| Replies never arrive or show an error | Check the backend logs. The most common causes are a missing or invalid `OPENAI_API_KEY`, or the database not being reachable. |
| A PDF chip shows "Upload failed" | Qdrant is not running (start it with `docker compose up -d` in the backend folder), or the file is over 10 MB or is not really a PDF. |
| An image chip shows "Upload failed" | The file is over 5 MB, or its contents are not a real PNG, JPEG, WebP, or GIF. |
| Image thumbnails are broken after a reload | The session has expired (images need the session cookie), or the image row no longer exists on the backend. |
| Pages look broken after upgrading packages | Run `bun run dev:clean` to clear the Next.js cache. |

---

## License

No license file is included in this project.
