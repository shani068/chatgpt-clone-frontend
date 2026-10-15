"use client";

import {
  AlertCircle,
  FileJson,
  FileSpreadsheet,
  FileText,
  ImageIcon,
  Loader2,
  X,
} from "lucide-react";

import { IconButton } from "@/components/ui/icon-button";
import { formatBytes } from "@/lib/chat/chat-utils";
import type { Attachment } from "@/types/file";
import { cn } from "@/utils/cn";

const ICON_BY_EXTENSION: Record<string, typeof FileText> = {
  png: ImageIcon,
  jpg: ImageIcon,
  jpeg: ImageIcon,
  webp: ImageIcon,
  gif: ImageIcon,
  json: FileJson,
  csv: FileSpreadsheet,
  pdf: FileText,
  docx: FileText,
  txt: FileText,
};

/**
 * One attachment chip. The same component serves the composer (removable,
 * shows upload progress) and the sent message (static), because a file should
 * not change appearance the moment it is sent.
 */
export function FilePreview({
  attachment,
  onRemove,
  className,
}: {
  attachment: Attachment;
  onRemove?: (id: string) => void;
  className?: string;
}) {
  const Icon = ICON_BY_EXTENSION[attachment.extension] ?? FileText;
  const isUploading = attachment.status === "uploading" || attachment.status === "pending";
  const isError = attachment.status === "error";
  // Local object URL while composing; the stored copy after a reload.
  const thumbnail = attachment.previewUrl ?? attachment.url;

  return (
    <div
      className={cn(
        "group/file relative flex min-w-0 max-w-60 items-center gap-2.5 overflow-hidden rounded-lg border bg-card py-1.5 pl-1.5 pr-2.5",
        isError ? "border-destructive/40 bg-destructive/5" : "border-border",
        className,
      )}
    >
      <span
        className={cn(
          "relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md",
          isError ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
        )}
      >
        {thumbnail && !isError ? (
          // Object URLs are local and short-lived — next/image has nothing to
          // optimise here and rejects the blob: protocol outright.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnail}
            alt=""
            className="absolute inset-0 size-full object-cover"
          />
        ) : isError ? (
          <AlertCircle size={15} strokeWidth={2} aria-hidden />
        ) : (
          <Icon size={15} strokeWidth={1.75} aria-hidden />
        )}
      </span>

      <span className="flex min-w-0 flex-col">
        <span className="text-caption text-foreground truncate font-medium">
          {attachment.name}
        </span>
        <span
          className={cn(
            "flex items-center gap-1 truncate text-[0.6875rem]",
            isError ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {isError ? (
            attachment.error
          ) : isUploading ? (
            <>
              <Loader2 size={10} strokeWidth={2.5} aria-hidden className="animate-spin" />
              {attachment.progress}%
            </>
          ) : (
            <>
              {attachment.extension.toUpperCase()}
              <span aria-hidden>·</span>
              {formatBytes(attachment.size)}
            </>
          )}
        </span>
      </span>

      {onRemove ? (
        <IconButton
          size="xs"
          label={`Remove ${attachment.name}`}
          showTooltip={false}
          onClick={() => onRemove(attachment.id)}
          icon={<X size={12} strokeWidth={2.5} aria-hidden />}
          className="ml-auto"
        />
      ) : null}

      {isUploading ? (
        <span
          className="bg-accent absolute inset-x-0 bottom-0 h-0.5 transition-[width] duration-200 ease-out"
          style={{ width: `${attachment.progress}%` }}
          aria-hidden
        />
      ) : null}
    </div>
  );
}

/** Sent image — large enough to read a screenshot; opens full size in a new tab. */
function ImageThumbnail({ attachment }: { attachment: Attachment }) {
  const src = attachment.previewUrl ?? attachment.url;
  if (!src) return <FilePreview attachment={attachment} />;

  return (
    <a
      href={attachment.url ?? src}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${attachment.name}`}
      className="border-border bg-muted focus-visible:ring-ring/40 block overflow-hidden rounded-lg border outline-none focus-visible:ring-[3px]"
    >
      {/* Same-origin or blob: URLs — next/image adds nothing here. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={attachment.name}
        loading="lazy"
        className="block max-h-60 w-auto max-w-[min(18rem,70vw)] object-contain"
      />
    </a>
  );
}

/** Row of chips shown under a sent user message; images render as thumbnails. */
export function AttachmentList({
  attachments,
  className,
}: {
  attachments: Attachment[];
  className?: string;
}) {
  if (attachments.length === 0) return null;

  return (
    <ul className={cn("flex flex-wrap justify-end gap-1.5", className)}>
      {attachments.map((attachment) => (
        <li key={attachment.id}>
          {attachment.kind === "image" ? (
            <ImageThumbnail attachment={attachment} />
          ) : (
            <FilePreview attachment={attachment} />
          )}
        </li>
      ))}
    </ul>
  );
}
