# Project structure

Source lives at the repository root (no `src/`). Path alias: `@/*` → `./*`.
For setup, architecture, and limitations, see [`README.md`](README.md).

```
app/
  layout.tsx                    fonts, metadata, viewport, provider tree
  page.tsx                      / — HomeEntry: marketing when signed out, chat when signed in
  error.tsx                     root error boundary
  not-found.tsx                 404
  globals.css                   ← the entire design system
  c/[conversationId]/page.tsx   /c/:id — an existing conversation (ChatShell)
  chat/
    layout.tsx                  metadata + viewport pinning
    page.tsx                    legacy /chat → redirects to /
    [chatId]/page.tsx           legacy /chat/:id → redirects to /c/:id
  (auth)/
    layout.tsx                  centred column with the hero grid
    login/page.tsx              /login  (+ loading.tsx skeleton)
    register/page.tsx           /register
  (dashboard)/
    layout.tsx                  page canvas for non-chat app routes
    settings/page.tsx           /settings
    dashboard/page.tsx          legacy /dashboard → redirects to /

components/
  home-entry.tsx                picks MarketingHome or ChatShell from the session
  chat/
    chat-shell.tsx              frame: sidebar + main + overlays + shortcuts; opens the routed conversation
    chat-sidebar.tsx            docked and drawer variants
    chat-header.tsx             title, generation status, chat actions
    chat-message-list.tsx       scroll region, states, live-region wiring
    user-message.tsx            bubble + inline editing + attachments (no bubble for image-only)
    assistant-message.tsx       open content block + actions + retry on error
    streaming-message.tsx       in-flight answer and caret placement
    message-actions.tsx         copy / edit / regenerate / rating
    chat-composer.tsx           auto-grow input; attach via button, drag & drop, paste; real uploads; send & stop
    file-preview.tsx            attachment chip (pending/uploading/uploaded/error) + sent-image thumbnails
    scroll-to-bottom.tsx        jump pill
    welcome-screen.tsx          zero state
    prompt-suggestions.tsx      starter prompts
    markdown-renderer.tsx       react-markdown pipeline + component overrides
    code-block.tsx              language label, copy, scroll container
  sidebar/
    conversation-search.tsx     ⌘K command menu
    conversation-group.tsx      one dated bucket
    conversation-item.tsx       row, rename/pin/archive (PUT), delete confirmation
    user-menu.tsx               account, theme, shortcuts, sign out
  settings/
    settings-dialog.tsx         in-app dialog with section rail
    settings-panel.tsx          the sections themselves (shared)
    settings-section.tsx        section, row and segmented-choice primitives
    settings-page-content.tsx   full-page variant of the same sections
  features/auth/
    login-form.tsx  register-form.tsx  google-sign-in-button.tsx
  shared/
    logo.tsx  theme-toggle.tsx  toast-provider.tsx
    empty-state.tsx  error-state.tsx  loading-skeleton.tsx
  ui/
    button.tsx  icon-button.tsx  input.tsx  tooltip.tsx
    dialog.tsx  dropdown-menu.tsx  popover.tsx
    primitives.tsx              separator, skeleton, badge, kbd, avatar, switch
  marketing/
    marketing-home.tsx          landing page composition
    hero.tsx  feature-grid.tsx  product-preview.tsx
    how-it-works.tsx  call-to-action.tsx  site-footer.tsx
  layout/
    navbar.tsx                  marketing navigation

hooks/
  use-chat.ts                   active conversation + mutations
  use-chat-history.ts           list, grouping, filtering
  use-auto-scroll.ts            sticky-bottom scrolling
  use-keyboard-shortcuts.ts     global bindings + the hint table
  use-media-query.ts            breakpoints, reduced motion
  use-copy-to-clipboard.ts      clipboard write + copied flag
  useFetch.ts                   TanStack Query GET wrapper (conversation list)
  useApi.ts                     TanStack Query mutation wrappers (usePost / usePut / usePatch / useDelete;
                                useUpload exists but attachments use lib/chat/upload-*.ts instead)

lib/
  api.ts                        Axios instance (same origin, credentials, 401 → /login)
  auth-client.ts                Better Auth client + friendly error messages
  validations/auth.schema.ts    Zod schemas for the login and register forms
  chat/
    stream-chat.ts              POST /api/chat via DefaultChatTransport; UIMessage ↔ text; data-image / data-document parts
    upload-image.ts             POST /api/v1/images (multipart, progress) → imageId
    upload-document.ts          POST /api/v1/documents (multipart, progress) → documentId
    attachments.ts              extension/size/count checks, preview object-URL lifecycle
    chat-utils.ts               ids, titles, date bucketing, search, API → UI mapping (incl. saved attachments)
    markdown.ts                 highlight.js language registry + hast helpers
    mock-chat-service.ts        localStorage only: preferences, export/clear (see "Leftovers")
    mock-responses.ts           canned answers used only by the unused mock streaming code

providers/
  app-providers.tsx             composition order
  query-provider.tsx            TanStack Query client
  session-provider.tsx          current user via Better Auth
  chat-provider.tsx             conversations (backend), send / stream / regenerate / edit
  preferences-provider.tsx      settings persisted to localStorage

types/                          api.ts, chat.ts, file.ts (attachments + part payloads), user.ts, auth.d.ts
constants/                      config.ts, routes.ts (routes + API paths), motion.ts
utils/                          cn.ts, format-date.ts, resolve-error.ts
proxy.ts                        server-side session check for private routes
next.config.ts                  rewrites /api/* → BACKEND_URL
```

## Conventions

- **Colour comes only from tokens.** Components use `bg-card`, `text-muted-foreground`,
  `border-border` — never a raw hex or a Tailwind palette colour.
- **Client components are leaves.** Pages and layouts stay server components; the
  `"use client"` boundary starts at the interactive component.
- **Network calls go through `lib/`.** REST via `lib/api.ts` (directly or through
  `useFetch` / `useApi`), chat via `lib/chat/stream-chat.ts`, uploads via
  `lib/chat/upload-*.ts`. Paths come from `constants/routes.ts`.
- **Icon buttons take a required `label`**, which becomes both the accessible name
  and the tooltip — an unlabelled icon button is unrepresentable.

## Data flow

```
route (/ or /c/:id)
   → ChatShell effect: openConversation(id)
   → ChatProvider: GET /api/v1/conversations/:id + GET /api/v1/messages?conversationId=
                   → apiMessageToMessage() (text + attachments from stored parts)
   → useChat()          → message list, composer, header
   → useChatHistory()   → sidebar, ⌘K search (list from useFetch(CONVERSATIONS_API))

composer
   → add file → validateFile() → uploadImage() / uploadDocument() → chip gets imageId / documentId
   → send     → ChatProvider.sendMessage(text, uploadedAttachments)
              → (first message) POST /api/v1/conversations, URL → /c/:id
              → streamChatResponse(): POST /api/chat { id, message } — newest message only
              → readUIMessageStream updates the assistant message on every chunk
              → on finish: invalidate the conversation list (the backend has already saved the turn)
```

The backend owns history and persistence. The frontend keeps the open conversation
in React state and never writes messages itself.

## Leftovers

These files are not imported by the running app. They compile, and are kept from the
original starter or the earlier mock backend:

`services/*` · `lib/auth.ts` · `lib/resolve-error.ts` · `components/features/dashboard/*` ·
`components/layout/sidebar.tsx` · `components/ui/spinner.tsx` ·
`app/(dashboard)/dashboard/{error,loading}.tsx` · `lib/chat/mock-responses.ts`

`lib/chat/mock-chat-service.ts` is partly live: `loadPreferences` / `savePreferences`
(preferences provider) and `exportConversations` / `clearAllConversations` (settings
panel) are used. Its conversation and streaming functions are not.
