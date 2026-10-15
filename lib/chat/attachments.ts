import type {
  Attachment,
  AttachmentKind,
  AcceptedExtension,
} from "@/types/file";
import {
  ACCEPTED_EXTENSIONS,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_IMAGE_BYTES,
} from "@/types/file";

import { createId, formatBytes } from "./chat-utils";

export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(",");

const KIND_BY_EXTENSION: Record<AcceptedExtension, AttachmentKind> = {
  pdf: "document",
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
};

function fallbackMimeType(extension: AcceptedExtension): string {
  if (KIND_BY_EXTENSION[extension] !== "image") return `application/${extension}`;
  return `image/${extension === "jpg" ? "jpeg" : extension}`;
}

export function extensionOf(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? (parts.pop() as string).toLowerCase() : "";
}

export function isAcceptedExtension(ext: string): ext is AcceptedExtension {
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(ext);
}

export type ValidationResult =
  | { ok: true; attachment: Attachment }
  | { ok: false; reason: string };

/**
 * Validates a picked file and turns it into an Attachment in `pending` state.
 * Rejection reasons are written to be shown verbatim to the user.
 */
export function validateFile(file: File, existingCount: number): ValidationResult {
  if (existingCount >= MAX_ATTACHMENTS_PER_MESSAGE) {
    return {
      ok: false,
      reason: `Up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message`,
    };
  }

  const extension = extensionOf(file.name);

  if (!isAcceptedExtension(extension)) {
    return {
      ok: false,
      reason: `${extension ? `.${extension}` : "That file type"} is not supported`,
    };
  }

  const kind = KIND_BY_EXTENSION[extension];
  const maxBytes = kind === "image" ? MAX_IMAGE_BYTES : MAX_ATTACHMENT_BYTES;

  if (file.size > maxBytes) {
    return {
      ok: false,
      reason: `${file.name} is ${formatBytes(file.size)} — the limit is ${formatBytes(maxBytes)}`,
    };
  }

  if (file.size === 0) {
    return { ok: false, reason: `${file.name} is empty` };
  }

  return {
    ok: true,
    attachment: {
      id: createId("file"),
      name: file.name,
      size: file.size,
      mimeType: file.type || fallbackMimeType(extension),
      extension,
      kind,
      status: "pending",
      progress: 0,
      previewUrl:
        kind === "image" && typeof URL !== "undefined"
          ? URL.createObjectURL(file)
          : undefined,
    },
  };
}

export function releasePreview(attachment: Attachment): void {
  if (attachment.previewUrl && typeof URL !== "undefined") {
    URL.revokeObjectURL(attachment.previewUrl);
  }
}
