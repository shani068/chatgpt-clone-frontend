// Attachments carry their own lifecycle so the composer can render each state.

export type AttachmentStatus = "pending" | "uploading" | "uploaded" | "error";

export type AttachmentKind = "image" | "document" | "data" | "text";

export interface Attachment {
  id: string;
  name: string;
  /** Bytes. */
  size: number;
  mimeType: string;
  extension: string;
  kind: AttachmentKind;
  status: AttachmentStatus;
  /** 0–100, only meaningful while uploading. */
  progress: number;
  /** Object URL for image previews; revoked when the attachment is dropped. */
  previewUrl?: string;
  /** Present when status is "error". */
  error?: string;
  /** Same-origin URL of the stored image, for sent messages and reloads. */
  url?: string;
  /** Backend id of the indexed PDF, sent with the message for RAG. */
  documentId?: string;
  /** Backend id of the uploaded image, sent with the message for the vision model. */
  imageId?: string;
}

/** Payload of the `data-document` message part — persisted with the message so attachments survive reloads. */
export interface DocumentPartData {
  documentId: string;
  name: string;
  size: number;
}

/** Payload of the `data-image` message part — the server loads the bytes by id. */
export interface ImagePartData {
  imageId: string;
  name: string;
  size: number;
  mediaType: string;
}

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB — mirrors the backend limit
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

// PDFs are indexed for RAG; images go to the vision model.
export const ACCEPTED_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "webp", "gif"] as const;

export type AcceptedExtension = (typeof ACCEPTED_EXTENSIONS)[number];
