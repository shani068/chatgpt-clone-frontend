"use client";

import { useRouter } from "next/navigation";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useToast } from "@/components/shared/toast-provider";
import { CONVERSATIONS_API, MESSAGES_API, ROUTES, conversationRoute } from "@/constants/routes";
import { useDelete, usePost } from "@/hooks/useApi";
import { useFetch } from "@/hooks/useFetch";
import { api } from "@/lib/api";
import {
  apiConversationToSummary,
  apiMessageToMessage,
  createId,
  deriveTitle,
} from "@/lib/chat/chat-utils";
import { streamChatResponse, textFromUiMessage, toUiMessage } from "@/lib/chat/stream-chat";
import { useSession } from "@/providers/session-provider";
import type { ApiConversation, ApiEnvelope, ApiMessage } from "@/types/api";
import type { Conversation, ConversationSummary, Message, MessageFeedback } from "@/types/chat";
import type { Attachment } from "@/types/file";

import type { UIMessage } from "ai";

type LoadStatus = "idle" | "loading" | "ready" | "error";

interface ChatContextValue {
  conversations: ConversationSummary[];
  historyStatus: LoadStatus;
  refreshHistory: () => Promise<void>;

  activeId: string | null;
  conversation: Conversation | null;
  messages: Message[];
  conversationStatus: LoadStatus;
  openConversation: (id: string | null) => void;

  isStreaming: boolean;
  sendMessage: (content: string, attachments?: Attachment[]) => Promise<void>;
  stopGeneration: () => void;
  regenerate: () => void;
  retryMessage: (messageId: string) => void;
  editMessage: (messageId: string, content: string) => void;
  setFeedback: (messageId: string, feedback: MessageFeedback) => void;

  startNewChat: () => void;
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  leaveIfActive: (id: string) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

function domainToUiMessages(messages: Message[]): UIMessage[] {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .filter((message) => message.status !== "error" || message.content.length > 0)
    .map((message) =>
      toUiMessage({
        id: message.id,
        role: message.role,
        content: message.content,
      })
    );
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { toast } = useToast();
  const { status: sessionStatus } = useSession();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [conversationStatus, setConversationStatus] = useState<LoadStatus>("idle");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const conversationRef = useRef<Conversation | null>(null);
  conversationRef.current = conversation;

  const {
    data: listResponse,
    isLoading: isHistoryLoading,
    isError: hasHistoryError,
    invalidate: invalidateConversations,
  } = useFetch<ApiEnvelope<ApiConversation[]>>(
    sessionStatus === "authenticated" ? CONVERSATIONS_API : null,
    ["conversations"],
    { enabled: sessionStatus === "authenticated" }
  );

  const conversations = useMemo(() => {
    const rows = listResponse?.data ?? [];
    return rows
      .filter((row) => !row.isArchived)
      .map(apiConversationToSummary)
      .sort(
        (a, b) =>
          Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned)) || b.updatedAt - a.updatedAt
      );
  }, [listResponse]);

  const historyStatus: LoadStatus =
    sessionStatus !== "authenticated"
      ? "idle"
      : isHistoryLoading
        ? "loading"
        : hasHistoryError
          ? "error"
          : "ready";

  const refreshHistory = useCallback(() => invalidateConversations(), [invalidateConversations]);

  const { mutateAsync: createConversationApi } = usePost<
    ApiEnvelope<ApiConversation>,
    { title?: string }
  >(CONVERSATIONS_API, {
    invalidateKeys: [["conversations"]],
  });

  const { mutateAsync: deleteConversationApi } = useDelete<ApiEnvelope<null>>(CONVERSATIONS_API, {
    invalidateKeys: [["conversations"]],
  });

  const openConversation = useCallback((id: string | null) => {
    if (id === null) {
      setActiveId(null);
      setConversation(null);
      setConversationStatus("idle");
      return;
    }

    if (conversationRef.current?.id === id) {
      setActiveId(id);
      setConversationStatus("ready");
      return;
    }

    setActiveId(id);
    setConversationStatus("loading");

    void (async () => {
      try {
        const [conversationRes, messagesRes] = await Promise.all([
          api.get<ApiEnvelope<ApiConversation>>(`${CONVERSATIONS_API}/${id}`),
          api.get<ApiEnvelope<ApiMessage[]>>(MESSAGES_API, {
            params: { conversationId: id },
          }),
        ]);

        const found = conversationRes.data.data;
        const messages = (messagesRes.data.data ?? []).map(apiMessageToMessage);

        setConversation({
          id: found.id,
          title: found.title,
          createdAt: new Date(found.createdAt).getTime(),
          updatedAt: new Date(found.updatedAt).getTime(),
          messages,
        });
        setConversationStatus("ready");
      } catch {
        setConversation(null);
        setConversationStatus("error");
      }
    })();
  }, []);

  const startNewChat = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    openConversation(null);
    router.push(ROUTES.CHAT);
  }, [openConversation, router]);

  const runStream = useCallback(
    async (target: Conversation, userMessage: Message, assistantId: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);

      const uiHistory = [
        ...domainToUiMessages(
          target.messages.filter(
            (message) => message.id !== assistantId && message.id !== userMessage.id
          )
        ),
        toUiMessage({
          id: userMessage.id,
          role: "user",
          content: userMessage.content,
          attachments: userMessage.attachments,
        }),
      ];

      const patchAssistantByPlaceholder = (updater: (message: Message) => Message) => {
        setConversation((current) => {
          if (current?.id !== target.id) return current;

          let hasMatched = false;
          const messages = current.messages.map((message) => {
            if (!hasMatched && (message.id === assistantId || message.status === "streaming")) {
              hasMatched = true;
              return updater(message);
            }
            return message;
          });

          return { ...current, messages };
        });
      };

      try {
        const finalMessage = await streamChatResponse({
          conversationId: target.id,
          messages: uiHistory,
          abortSignal: controller.signal,
          onAssistantUpdate: (uiMessage, text) => {
            patchAssistantByPlaceholder((message) => ({
              ...message,
              id: uiMessage.id || message.id,
              content: text,
              status: "streaming",
              error: undefined,
            }));
          },
        });

        const finalText = textFromUiMessage(finalMessage);

        setConversation((current) => {
          if (current?.id !== target.id) return current;
          return {
            ...current,
            updatedAt: Date.now(),
            title:
              current.title === "New Chat" || current.title === "New conversation"
                ? deriveTitle(userMessage.content)
                : current.title,
            messages: current.messages.map((message) =>
              message.id === assistantId ||
              message.id === finalMessage.id ||
              message.status === "streaming"
                ? {
                    ...message,
                    id: finalMessage.id,
                    content: finalText,
                    status: "idle" as const,
                    error: undefined,
                  }
                : message
            ),
          };
        });

        void invalidateConversations();
      } catch (error) {
        if (controller.signal.aborted) {
          patchAssistantByPlaceholder((message) => ({
            ...message,
            status: "idle",
            content: message.content || "_Generation stopped._",
          }));
          return;
        }

        const reason =
          error instanceof Error ? error.message : "The response could not be completed.";

        patchAssistantByPlaceholder((message) => ({
          ...message,
          status: "error",
          error: reason,
        }));
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        setIsStreaming(false);
      }
    },
    [invalidateConversations]
  );

  const sendMessage = useCallback(
    async (content: string, attachments: Attachment[] = []) => {
      const trimmed = content.trim();
      // An attached image can be the whole question.
      const hasImage = attachments.some((attachment) => attachment.imageId);
      if ((!trimmed && !hasImage) || isStreaming) return;

      let target = conversationRef.current;

      if (!target) {
        try {
          const created = await createConversationApi({
            title: "New Chat",
          });
          const row = created.data;
          target = {
            id: row.id,
            title: row.title,
            createdAt: new Date(row.createdAt).getTime(),
            updatedAt: new Date(row.updatedAt).getTime(),
            messages: [],
          };
          setActiveId(target.id);
          setConversationStatus("ready");
          window.history.replaceState(null, "", conversationRoute(target.id));
        } catch (error) {
          toast({
            title: "Could not start conversation",
            description: error instanceof Error ? error.message : undefined,
            variant: "error",
          });
          return;
        }
      }

      const userMessage: Message = {
        id: createId("msg"),
        role: "user",
        content: trimmed,
        createdAt: Date.now(),
        status: "idle",
        attachments: attachments.length ? attachments : undefined,
      };

      const assistantMessage: Message = {
        id: createId("msg"),
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        status: "streaming",
      };

      const next: Conversation = {
        ...target,
        title: target.messages.length === 0 ? deriveTitle(trimmed) : target.title,
        updatedAt: Date.now(),
        messages: [...target.messages, userMessage, assistantMessage],
      };

      setConversation(next);
      conversationRef.current = next;

      await runStream(next, userMessage, assistantMessage.id);
    },
    [createConversationApi, isStreaming, runStream, toast]
  );

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);

    setConversation((current) => {
      if (!current) return current;
      return {
        ...current,
        messages: current.messages.map((message) =>
          message.status === "streaming"
            ? {
                ...message,
                status: "idle" as const,
                content: message.content || "_Generation stopped._",
              }
            : message
        ),
      };
    });
  }, []);

  const regenerateAt = useCallback(
    (assistantId: string) => {
      const current = conversationRef.current;
      if (!current || isStreaming) return;

      const index = current.messages.findIndex((message) => message.id === assistantId);
      if (index < 1) return;

      const prompt = [...current.messages.slice(0, index)]
        .reverse()
        .find((message) => message.role === "user");
      if (!prompt) return;

      const userMessage: Message = {
        ...prompt,
        id: createId("msg"),
        createdAt: Date.now(),
        status: "idle",
        edited: prompt.edited,
      };

      const assistantMessage: Message = {
        id: createId("msg"),
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        status: "streaming",
      };

      const next: Conversation = {
        ...current,
        updatedAt: Date.now(),
        messages: [...current.messages.slice(0, index), userMessage, assistantMessage],
      };

      setConversation(next);
      conversationRef.current = next;
      void runStream(next, userMessage, assistantMessage.id);
    },
    [isStreaming, runStream]
  );

  const regenerate = useCallback(() => {
    const current = conversationRef.current;
    const last = [...(current?.messages ?? [])]
      .reverse()
      .find((message) => message.role === "assistant");
    if (last) regenerateAt(last.id);
  }, [regenerateAt]);

  const retryMessage = useCallback((messageId: string) => regenerateAt(messageId), [regenerateAt]);

  const editMessage = useCallback(
    (messageId: string, content: string) => {
      const current = conversationRef.current;
      const trimmed = content.trim();
      if (!current || !trimmed || isStreaming) return;

      const index = current.messages.findIndex((message) => message.id === messageId);
      if (index === -1) return;

      const userMessage: Message = {
        ...current.messages[index],
        id: createId("msg"),
        content: trimmed,
        edited: true,
        createdAt: Date.now(),
        status: "idle",
      };

      const assistantMessage: Message = {
        id: createId("msg"),
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        status: "streaming",
      };

      const next: Conversation = {
        ...current,
        title: index === 0 ? deriveTitle(trimmed) : current.title,
        updatedAt: Date.now(),
        messages: [...current.messages.slice(0, index), userMessage, assistantMessage],
      };

      setConversation(next);
      conversationRef.current = next;
      void runStream(next, userMessage, assistantMessage.id);
    },
    [isStreaming, runStream]
  );

  const setFeedback = useCallback((messageId: string, feedback: MessageFeedback) => {
    setConversation((current) => {
      if (!current) return current;
      return {
        ...current,
        messages: current.messages.map((message) =>
          message.id === messageId
            ? { ...message, feedback: message.feedback === feedback ? null : feedback }
            : message
        ),
      };
    });
  }, []);

  const updateConversationFields = useCallback(
    async (id: string, body: { title?: string; isPinned?: boolean; isArchived?: boolean }) => {
      const res = await api.put<ApiEnvelope<ApiConversation>>(`${CONVERSATIONS_API}/${id}`, body);
      void invalidateConversations();
      return res.data.data;
    },
    [invalidateConversations]
  );

  const rename = useCallback(
    async (id: string, title: string) => {
      try {
        const updated = await updateConversationFields(id, { title });
        setConversation((current) =>
          current?.id === id ? { ...current, title: updated.title } : current
        );
        toast({ title: "Conversation renamed", variant: "success" });
      } catch (error) {
        toast({
          title: "Could not rename",
          description: error instanceof Error ? error.message : undefined,
          variant: "error",
        });
      }
    },
    [toast, updateConversationFields]
  );

  const leaveIfActive = useCallback(
    (id: string) => {
      if (conversationRef.current?.id !== id) return;
      abortRef.current?.abort();
      abortRef.current = null;
      setIsStreaming(false);
      openConversation(null);
      router.push(ROUTES.CHAT);
    },
    [openConversation, router]
  );

  const remove = useCallback(
    async (id: string) => {
      const removed = conversations.find((entry) => entry.id === id);

      try {
        await deleteConversationApi(id);
      } catch {
        toast({ title: "Could not delete conversation", variant: "error" });
        return;
      }

      leaveIfActive(id);

      toast({
        title: "Conversation deleted",
        description: removed?.title,
        variant: "default",
      });
    },
    [conversations, deleteConversationApi, leaveIfActive, toast]
  );

  useEffect(() => () => abortRef.current?.abort(), []);

  const value = useMemo<ChatContextValue>(
    () => ({
      conversations,
      historyStatus,
      refreshHistory,
      activeId,
      conversation,
      messages: conversation?.messages ?? [],
      conversationStatus,
      openConversation,
      isStreaming,
      sendMessage,
      stopGeneration,
      regenerate,
      retryMessage,
      editMessage,
      setFeedback,
      startNewChat,
      rename,
      remove,
      leaveIfActive,
    }),
    [
      conversations,
      historyStatus,
      refreshHistory,
      activeId,
      conversation,
      conversationStatus,
      openConversation,
      isStreaming,
      sendMessage,
      stopGeneration,
      regenerate,
      retryMessage,
      editMessage,
      setFeedback,
      startNewChat,
      rename,
      remove,
      leaveIfActive,
    ]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatContext(): ChatContextValue {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChatContext must be used inside <ChatProvider>");
  }
  return context;
}
