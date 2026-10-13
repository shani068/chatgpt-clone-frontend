import {
  DefaultChatTransport,
  readUIMessageStream,
  type UIMessage,
} from "ai";

import { API_BASE_URL } from "@/constants/config";
import { CHAT_API } from "@/constants/routes";

function chatApiUrl(): string {
  if (!API_BASE_URL || API_BASE_URL.startsWith("/")) {
    return CHAT_API;
  }

  try {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    if (origin && new URL(API_BASE_URL).origin === origin) {
      return CHAT_API;
    }
  } catch {
    /* use absolute below */
  }

  return `${API_BASE_URL.replace(/\/$/, "")}${CHAT_API}`;
}

export function textFromUiMessage(message: UIMessage): string {
  return message.parts
    .filter(
      (part): part is Extract<UIMessage["parts"][number], { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("");
}

export function toUiMessage(input: {
  id: string;
  role: "user" | "assistant";
  content: string;
}): UIMessage {
  return {
    id: input.id,
    role: input.role,
    parts: [{ type: "text", text: input.content }],
  };
}

export interface StreamChatOptions {
  conversationId: string;
  /** Full local UI history including the newest user message. */
  messages: UIMessage[];
  abortSignal: AbortSignal;
  onAssistantUpdate: (message: UIMessage, text: string) => void;
}

/**
 * Streams an assistant reply from Express `/api/chat`.
 * Sends only the last message + conversation id (server owns history).
 * Uses `DefaultChatTransport` + `readUIMessageStream` from the `ai` package.
 */
export async function streamChatResponse(
  options: StreamChatOptions,
): Promise<UIMessage> {
  const transport = new DefaultChatTransport<UIMessage>({
    api: chatApiUrl(),
    credentials: "include",
    prepareSendMessagesRequest: ({ id, messages }) => {
      const message = messages[messages.length - 1];
      if (!message) {
        throw new Error("Cannot send an empty message list");
      }

      return {
        body: {
          id,
          message,
        },
      };
    },
  });

  const chunkStream = await transport.sendMessages({
    trigger: "submit-message",
    chatId: options.conversationId,
    messageId: undefined,
    messages: options.messages,
    abortSignal: options.abortSignal,
  });

  let latest: UIMessage | undefined;

  // terminateOnError: surface server `error` chunks (bad API key, quota, …) as a thrown
  // Error instead of silently finishing with an empty assistant message.
  for await (const message of readUIMessageStream({
    stream: chunkStream,
    terminateOnError: true,
  })) {
    latest = message;
    options.onAssistantUpdate(message, textFromUiMessage(message));
  }

  if (!latest) {
    throw new Error("The assistant returned an empty stream");
  }

  return latest;
}
