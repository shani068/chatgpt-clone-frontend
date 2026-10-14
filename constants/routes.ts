// Central route map — import ROUTES instead of hardcoding path strings
export const ROUTES = {
  HOME: "/",
  LOGIN: "/login",
  REGISTER: "/register",
  /** New chat home when authenticated (ChatGPT-style root). */
  CHAT: "/",
  /**
   * Auth-gated entry for marketing CTAs. Unauthenticated visitors are sent to
   * login; the page itself redirects into `CHAT`.
   */
  CHAT_ENTRY: "/chat",
  SETTINGS: "/settings",
} as const;

export const CONVERSATIONS_API = "/api/v1/conversations" as const;
export const MESSAGES_API = "/api/v1/messages" as const;
export const CHAT_API = "/api/chat" as const;
export const DOCUMENTS_API = "/api/v1/documents" as const;

export const conversationRoute = (id: string) => `/c/${id}` as const;

export type Route = (typeof ROUTES)[keyof typeof ROUTES];
