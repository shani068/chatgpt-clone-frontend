/**
 * Mock chat backend.
 *
 * Every method here is the shape a real API client would have — async,
 * failable, returning domain objects. Components never touch localStorage or
 * setTimeout directly, so swapping this file for `fetch` calls is the whole
 * migration.
 */

import type {
  Conversation,
  ConversationSummary,
  Message,
  StreamCallbacks,
  StreamHandle,
} from "@/types/chat";
import type { Attachment } from "@/types/file";
import type { UserPreferences } from "@/types/user";
import { DEFAULT_PREFERENCES } from "@/types/user";

import { createId, deriveTitle, toSummary } from "./chat-utils";
import { attachmentPreface, responseFor } from "./mock-responses";

/**
 * Cadence of the simulated stream. This used to vary per selected model; with a
 * single model it belongs to the service, not to the call site.
 */
const STREAM_PROFILE = {
  /** Delay between chunks, before jitter. */
  chunkMs: 18,
  charsPerChunk: 5,
  /** Pause before the first token lands. */
  firstTokenMs: 320,
} as const;

const CONVERSATIONS_KEY = "chatgpt.conversations.v1";
const PREFERENCES_KEY = "chatgpt.preferences.v1";
const USER_KEY = "chatgpt.user.v1";

/** Rare enough not to be irritating, frequent enough to prove the retry path. */
const FAILURE_RATE = 0.02;

/* ── storage ────────────────────────────────────────────────────────────── */

function readStore<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    // Private browsing, quota, or corrupt JSON — degrade to in-memory.
    return fallback;
  }
}

function writeStore<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Persistence is a nicety; the session still works without it. */
  }
}

function readConversations(): Conversation[] {
  return readStore<Conversation[]>(CONVERSATIONS_KEY, []);
}

function writeConversations(conversations: Conversation[]): void {
  writeStore(CONVERSATIONS_KEY, conversations);
}

/** Simulated network latency, kept short enough to stay pleasant. */
function latency(min = 90, max = 220): Promise<void> {
  const ms = min + Math.random() * (max - min);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ── conversations ──────────────────────────────────────────────────────── */

export async function getConversations(): Promise<ConversationSummary[]> {
  await latency(120, 320);
  return readConversations()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(toSummary);
}

export async function getConversation(id: string): Promise<Conversation | null> {
  await latency(60, 160);
  return readConversations().find((c) => c.id === id) ?? null;
}

export async function createConversation(): Promise<Conversation> {
  await latency(40, 110);
  const now = Date.now();
  const conversation: Conversation = {
    id: createId("conv"),
    title: "New conversation",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  writeConversations([conversation, ...readConversations()]);
  return conversation;
}

export async function renameConversation(
  id: string,
  title: string,
): Promise<Conversation> {
  await latency(60, 140);
  const trimmed = title.trim();
  if (!trimmed) throw new Error("Title cannot be empty");
  if (trimmed.length > 80) throw new Error("Title is too long");

  const conversations = readConversations();
  const target = conversations.find((c) => c.id === id);
  if (!target) throw new Error("Conversation not found");

  target.title = trimmed;
  target.updatedAt = Date.now();
  writeConversations(conversations);
  return target;
}

export async function deleteConversation(id: string): Promise<void> {
  await latency(60, 140);
  writeConversations(readConversations().filter((c) => c.id !== id));
}

export async function clearAllConversations(): Promise<void> {
  await latency(80, 180);
  writeConversations([]);
}

/** Everything the user has stored here, as a portable JSON document. */
export async function exportConversations(): Promise<string> {
  await latency(60, 140);
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      version: 1,
      conversations: readConversations(),
    },
    null,
    2,
  );
}

/** Whole-conversation upsert — the write path for every message mutation. */
export async function saveConversation(
  conversation: Conversation,
): Promise<void> {
  await latency(20, 60);
  const conversations = readConversations();
  conversation = stripEphemeralFields(conversation);
  const index = conversations.findIndex((c) => c.id === conversation.id);
  if (index === -1) conversations.unshift(conversation);
  else conversations[index] = conversation;
  writeConversations(conversations);
}

/**
 * Object URLs only live as long as the document that created them, so they are
 * dropped before writing. A restored attachment falls back to its file icon.
 */
function stripEphemeralFields(conversation: Conversation): Conversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) =>
      message.attachments
        ? {
            ...message,
            attachments: message.attachments.map(
              ({ previewUrl: _previewUrl, ...rest }) => rest,
            ),
          }
        : message,
    ),
  };
}

/* ── messages ───────────────────────────────────────────────────────────── */

export function buildUserMessage(
  content: string,
  attachments: Attachment[] = [],
): Message {
  return {
    id: createId("msg"),
    role: "user",
    content,
    createdAt: Date.now(),
    status: "idle",
    attachments: attachments.length ? attachments : undefined,
  };
}

export function buildAssistantMessage(): Message {
  return {
    id: createId("msg"),
    role: "assistant",
    content: "",
    createdAt: Date.now(),
    status: "streaming",
    feedback: null,
  };
}

/** Titles are derived on the first exchange only, never overwritten after. */
export function titleForFirstMessage(content: string): string {
  return deriveTitle(content);
}

/* ── streaming ──────────────────────────────────────────────────────────── */

interface StreamOptions {
  prompt: string;
  /** 0 for the first answer, incremented on each regeneration. */
  variant?: number;
  attachmentNames?: string[];
  /** When false the answer lands in one piece (a user preference). */
  shouldStream?: boolean;
}

/**
 * Streams a simulated completion token-by-token.
 *
 * Chunking is word-aware and pauses slightly at sentence and block boundaries,
 * so the cadence reads like generation rather than a progress bar.
 */
export function streamAssistantResponse(
  options: StreamOptions,
  callbacks: StreamCallbacks,
): StreamHandle {
  const { prompt, variant = 0, attachmentNames = [], shouldStream = true } = options;
  const profile = STREAM_PROFILE;

  const full = attachmentPreface(attachmentNames) + responseFor(prompt, variant);

  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const fail = () => {
    callbacks.onError(
      "The model stopped responding before it finished. This is usually transient.",
    );
  };

  // Deterministic escape hatch for demoing the inline error state.
  const shouldForceError = /^\s*\/error\b/i.test(prompt);

  if (!shouldStream) {
    timer = setTimeout(() => {
      if (cancelled) return;
      if (shouldForceError || Math.random() < FAILURE_RATE) return fail();
      callbacks.onToken(full, full);
      callbacks.onDone(full);
    }, profile.firstTokenMs + 400);

    return {
      stop: () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
      },
    };
  }

  const chunks = chunkText(full, profile.charsPerChunk);
  let index = 0;
  let emitted = "";
  // Failure, when it happens, lands mid-stream where it is most instructive.
  const failAt =
    shouldForceError || Math.random() < FAILURE_RATE
      ? Math.floor(chunks.length * (0.25 + Math.random() * 0.4))
      : -1;

  const tick = () => {
    if (cancelled) return;

    if (failAt >= 0 && index >= failAt) return fail();

    if (index >= chunks.length) {
      callbacks.onDone(emitted);
      return;
    }

    const chunk = chunks[index++];
    emitted += chunk;
    callbacks.onToken(chunk, emitted);

    timer = setTimeout(tick, delayFor(chunk, profile.chunkMs));
  };

  timer = setTimeout(tick, profile.firstTokenMs);

  return {
    stop: () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    },
  };
}

/** Splits on word boundaries so partial words never flash on screen. */
function chunkText(text: string, charsPerChunk: number): string[] {
  const tokens = text.match(/\s+|[^\s]+/g) ?? [];
  const chunks: string[] = [];
  let buffer = "";

  for (const token of tokens) {
    buffer += token;
    if (buffer.length >= charsPerChunk || token.includes("\n")) {
      chunks.push(buffer);
      buffer = "";
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

function delayFor(chunk: string, base: number): number {
  // Jitter keeps the rhythm from sounding mechanical.
  let delay = base * (0.6 + Math.random() * 0.8);
  if (/[.!?]\s*$/.test(chunk)) delay += base * 3;
  if (chunk.includes("\n\n")) delay += base * 4;
  return delay;
}

/* ── preferences & session ──────────────────────────────────────────────── */

export function loadPreferences(): UserPreferences {
  const stored = readStore<Partial<UserPreferences>>(PREFERENCES_KEY, {});
  return {
    ...DEFAULT_PREFERENCES,
    ...stored,
    chat: { ...DEFAULT_PREFERENCES.chat, ...(stored.chat ?? {}) },
  };
}

export function savePreferences(preferences: UserPreferences): void {
  writeStore(PREFERENCES_KEY, preferences);
}

export { USER_KEY, CONVERSATIONS_KEY, PREFERENCES_KEY };
