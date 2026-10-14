import type { ApiConversation, ApiMessage } from "@/types/api";
import type {
  Conversation,
  ConversationBucket,
  ConversationGroupModel,
  ConversationSummary,
  Message,
} from "@/types/chat";
import type { Attachment, DocumentPartData } from "@/types/file";

const DAY_MS = 86_400_000;

export function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID().slice(0, 12)}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

/** Derives a conversation title from the first user message. */
export function deriveTitle(content: string): string {
  const cleaned = content
    .replace(/```[\s\S]*?```/g, " code ")
    .replace(/[#*`>_~\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "New conversation";

  const firstSentence = cleaned.split(/(?<=[.?!])\s/)[0] ?? cleaned;
  const source = firstSentence.length > 12 ? firstSentence : cleaned;

  if (source.length <= 48) return capitalise(source);
  return `${capitalise(source.slice(0, 46)).trimEnd()}…`;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function bucketFor(timestamp: number, now = Date.now()): ConversationBucket {
  const today = startOfDay(now);
  const day = startOfDay(timestamp);
  const diffDays = Math.round((today - day) / DAY_MS);

  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 7) return "Previous 7 days";
  return "Older";
}

const BUCKET_ORDER: ConversationBucket[] = [
  "Today",
  "Yesterday",
  "Previous 7 days",
  "Older",
];

/** Groups summaries into the four sidebar buckets, newest first, empties dropped. */
export function groupConversations(
  conversations: ConversationSummary[],
  now = Date.now(),
): ConversationGroupModel[] {
  const byBucket = new Map<ConversationBucket, ConversationSummary[]>();

  for (const conversation of [...conversations].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  )) {
    const bucket = bucketFor(conversation.updatedAt, now);
    const list = byBucket.get(bucket);
    if (list) list.push(conversation);
    else byBucket.set(bucket, [conversation]);
  }

  return BUCKET_ORDER.filter((bucket) => byBucket.has(bucket)).map((bucket) => ({
    bucket,
    conversations: byBucket.get(bucket) as ConversationSummary[],
  }));
}

export function toSummary(conversation: Conversation): ConversationSummary {
  const last = conversation.messages[conversation.messages.length - 1];
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length,
    preview: last ? previewOf(last) : "",
  };
}

/** Maps a backend conversation row into the sidebar summary shape. */
export function apiConversationToSummary(
  conversation: ApiConversation,
): ConversationSummary {
  const updatedAt = new Date(
    conversation.lastMessageAt || conversation.updatedAt,
  ).getTime();

  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: new Date(conversation.createdAt).getTime(),
    updatedAt,
    messageCount: 0,
    preview: "",
    isPinned: conversation.isPinned,
    isArchived: conversation.isArchived,
  };
}

/** Maps a backend message into the chat UI message shape. */
export function apiMessageToMessage(message: ApiMessage): Message {
  const role =
    message.role === "USER"
      ? ("user" as const)
      : ("assistant" as const);

  const status =
    message.status === "ERROR"
      ? ("error" as const)
      : message.status === "PENDING"
        ? ("streaming" as const)
        : ("idle" as const);

  const contentFromParts = textFromStoredParts(message.parts);
  const attachments = attachmentsFromStoredParts(message.parts);

  return {
    id: message.id,
    role,
    content: contentFromParts || message.content,
    createdAt: new Date(message.createdAt).getTime(),
    status: status === "streaming" ? "idle" : status,
    attachments: attachments.length ? attachments : undefined,
  };
}

/** Rebuilds uploaded PDFs from persisted `data-document` parts. */
function attachmentsFromStoredParts(parts: unknown): Attachment[] {
  if (!Array.isArray(parts)) return [];

  return parts
    .filter(
      (part): part is { type: "data-document"; data: DocumentPartData } =>
        part?.type === "data-document" && typeof part.data?.documentId === "string",
    )
    .map(({ data }) => ({
      id: data.documentId,
      documentId: data.documentId,
      // Older messages stored only the id.
      name: data.name ?? "Document.pdf",
      size: data.size ?? 0,
      mimeType: "application/pdf",
      extension: "pdf",
      kind: "document",
      status: "uploaded",
      progress: 100,
    }));
}

function textFromStoredParts(parts: unknown): string {
  if (!Array.isArray(parts)) return "";

  return parts
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        (part as { type: unknown }).type === "text" &&
        "text" in part &&
        typeof (part as { text: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("");
}

function previewOf(message: Message): string {
  const text = message.content.replace(/\s+/g, " ").trim();
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

export function searchConversations(
  conversations: ConversationSummary[],
  query: string,
): ConversationSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return conversations;

  return conversations
    .map((conversation) => {
      const title = conversation.title.toLowerCase();
      const preview = conversation.preview.toLowerCase();
      // Title matches outrank body matches, and prefixes outrank substrings.
      let score = 0;
      if (title.startsWith(q)) score = 3;
      else if (title.includes(q)) score = 2;
      else if (preview.includes(q)) score = 1;
      return { conversation, score };
    })
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || b.conversation.updatedAt - a.conversation.updatedAt,
    )
    .map((entry) => entry.conversation);
}

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60_000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(timestamp);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
