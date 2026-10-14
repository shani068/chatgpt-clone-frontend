"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type RefObject,
} from "react";

import { ArrowUp, Paperclip, Square } from "lucide-react";

import { useToast } from "@/components/shared/toast-provider";
import { IconButton } from "@/components/ui/icon-button";
import { Kbd } from "@/components/ui/primitives";
import { useIsAppleDevice } from "@/hooks/use-keyboard-shortcuts";
import { useIsMobile } from "@/hooks/use-media-query";
import { ACCEPT_ATTRIBUTE, releasePreview, validateFile } from "@/lib/chat/attachments";
import { uploadDocument } from "@/lib/chat/upload-document";
import { usePreferences } from "@/providers/preferences-provider";
import type { Attachment } from "@/types/file";
import { cn } from "@/utils/cn";

import { FilePreview } from "./file-preview";

const MAX_TEXTAREA_HEIGHT = 208;

interface ChatComposerProps {
  onSend: (content: string, attachments: Attachment[]) => void;
  onStop: () => void;
  isStreaming: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Disables input while a conversation is still loading. */
  disabled?: boolean;
}

export function ChatComposer({
  onSend,
  onStop,
  isStreaming,
  textareaRef,
  disabled = false,
}: ChatComposerProps) {
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  // Lets validation read the current count without re-creating the callback.
  const attachmentsRef = useRef<Attachment[]>(attachments);
  attachmentsRef.current = attachments;
  const { toast } = useToast();
  const { preferences } = usePreferences();
  const isApple = useIsAppleDevice();
  const isMobile = useIsMobile();

  const shouldSendOnEnter = preferences.chat.enterBehaviour === "send";
  const isUploading = attachments.some(
    (file) => file.status === "uploading" || file.status === "pending",
  );
  const canSend =
    draft.trim().length > 0 && !isStreaming && !isUploading && !disabled;

  /* Auto-grow ─────────────────────────────────────────────────────────── */

  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node) return;

    node.style.height = "auto";
    const next = Math.min(node.scrollHeight, MAX_TEXTAREA_HEIGHT);
    node.style.height = `${next}px`;
    // Past the cap the textarea scrolls internally instead of growing.
    node.style.overflowY = node.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
  }, [draft, textareaRef]);

  // Object URLs outlive React state unless they are explicitly released.
  useEffect(() => () => attachmentsRef.current.forEach(releasePreview), []);

  /* Attachments ───────────────────────────────────────────────────────── */

  const startUpload = useCallback(
    (attachment: Attachment, file: File) => {
      setAttachments((current) =>
        current.map((entry) =>
          entry.id === attachment.id
            ? { ...entry, status: "uploading" as const }
            : entry,
        ),
      );

      uploadDocument(file, (progress) => {
        setAttachments((current) =>
          current.map((entry) =>
            entry.id === attachment.id ? { ...entry, progress } : entry,
          ),
        );
      })
        .then((documentId) => {
          setAttachments((current) =>
            current.map((entry) =>
              entry.id === attachment.id
                ? { ...entry, status: "uploaded" as const, progress: 100, documentId }
                : entry,
            ),
          );
          toast({
            title: "File attached",
            description: attachment.name,
            variant: "success",
            duration: 2200,
          });
        })
        .catch(() => {
          setAttachments((current) =>
            current.map((entry) =>
              entry.id === attachment.id
                ? { ...entry, status: "error" as const, error: "Upload failed" }
                : entry,
            ),
          );
        });
    },
    [toast],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const incoming = Array.from(files);
      if (incoming.length === 0) return;

      // Validation happens outside the state updater — updaters must stay
      // pure, and React may run them twice in development.
      const accepted: { attachment: Attachment; file: File }[] = [];
      const rejected: string[] = [];
      let count = attachmentsRef.current.length;

      for (const file of incoming) {
        const result = validateFile(file, count);
        if (result.ok) {
          accepted.push({ attachment: result.attachment, file });
          count += 1;
        } else {
          rejected.push(result.reason);
        }
      }

      if (rejected.length) {
        toast({
          title:
            rejected.length === 1 ? "File rejected" : `${rejected.length} files rejected`,
          description: rejected[0],
          variant: "error",
        });
      }

      if (accepted.length === 0) return;

      setAttachments((current) => [...current, ...accepted.map((entry) => entry.attachment)]);
      accepted.forEach(({ attachment, file }) => startUpload(attachment, file));
    },
    [startUpload, toast],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => {
      const target = current.find((entry) => entry.id === id);
      if (target) releasePreview(target);
      return current.filter((entry) => entry.id !== id);
    });
  }, []);

  /* Send ──────────────────────────────────────────────────────────────── */

  const submit = useCallback(() => {
    if (!canSend) return;
    onSend(
      draft.trim(),
      attachments.filter((file) => file.status === "uploaded"),
    );
    setDraft("");
    setAttachments([]);
    // Reset the box before the next paint so it does not stay tall.
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (node) node.style.height = "auto";
    });
  }, [attachments, canSend, draft, onSend, textareaRef]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const hasModifier = event.metaKey || event.ctrlKey;

    if (event.key === "Enter") {
      if (hasModifier) {
        event.preventDefault();
        submit();
        return;
      }
      // In "send" mode Shift+Enter is the escape hatch for a newline.
      if (shouldSendOnEnter && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length) {
      event.preventDefault();
      addFiles(files);
    }
  };

  /* Drag & drop ───────────────────────────────────────────────────────── */

  const onDragEnter = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    dragDepth.current += 1;
    setIsDragging(true);
  };

  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
  };

  return (
    <div className="px-3 pt-1 pb-3 sm:px-6 sm:pb-5">
      <div className="mx-auto w-full max-w-3xl">
        {/* Drag-and-drop is a pointer-only shortcut layered on top of the
            attach button, which remains the keyboard path — so this container
            deliberately stays a plain div rather than claiming a role. */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div
          onDragEnter={onDragEnter}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={cn(
            "relative rounded-xl border bg-card shadow-e2 transition-colors duration-140",
            "focus-within:border-ring/50 focus-within:ring-[3px] focus-within:ring-ring/20",
            isDragging ? "border-accent bg-accent/5" : "border-border",
          )}
        >
          {isDragging ? (
            <div className="bg-card/85 text-small text-foreground pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl font-medium">
              Drop to attach
            </div>
          ) : null}

          {attachments.length ? (
            <ul className="border-border flex flex-wrap gap-1.5 border-b px-2.5 py-2">
              {attachments.map((attachment) => (
                <li key={attachment.id}>
                  <FilePreview attachment={attachment} onRemove={removeAttachment} />
                </li>
              ))}
            </ul>
          ) : null}

          <label htmlFor="chat-composer-input" className="sr-only">
            Message ChatGPT
          </label>
          <textarea
            id="chat-composer-input"
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            disabled={disabled}
            rows={1}
            placeholder={isStreaming ? "ChatGPT is responding…" : "Message ChatGPT…"}
            aria-describedby="composer-hint"
            className={cn(
              "block max-h-52 w-full resize-none bg-transparent px-3.5 pb-1.5 pt-3 text-chat text-foreground outline-none",
              "placeholder:text-muted-foreground/70",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          />

          <div className="flex items-center gap-1 px-2 pt-1 pb-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPT_ATTRIBUTE}
              className="sr-only"
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                // Allows re-picking the same file after a removal.
                event.target.value = "";
              }}
            />

            <IconButton
              size="md"
              label="Attach files"
              tooltipSide="top"
              showTooltip={!isMobile}
              disabled={disabled}
              onClick={() => fileInputRef.current?.click()}
              icon={<Paperclip size={16} strokeWidth={1.9} aria-hidden />}
            />

            <div className="ml-auto flex items-center gap-2">
              <p
                id="composer-hint"
                className="text-caption text-muted-foreground sr-only sm:not-sr-only sm:block"
              >
                {shouldSendOnEnter ? (
                  <>
                    <Kbd>{isApple ? "⇧↵" : "Shift+Enter"}</Kbd> for a new line
                  </>
                ) : (
                  <>
                    <Kbd>{isApple ? "⌘↵" : "Ctrl+Enter"}</Kbd> to send
                  </>
                )}
              </p>

              {isStreaming ? (
                <IconButton
                  size="lg"
                  variant="solid"
                  label="Stop generating"
                  tooltipSide="top"
                  showTooltip={!isMobile}
                  onClick={onStop}
                  icon={<Square size={13} strokeWidth={3} className="fill-current" aria-hidden />}
                />
              ) : (
                <IconButton
                  size="lg"
                  variant={canSend ? "solid" : "ghost"}
                  label="Send message"
                  tooltipSide="top"
                  showTooltip={!isMobile}
                  disabled={!canSend}
                  onClick={submit}
                  icon={<ArrowUp size={17} strokeWidth={2.25} aria-hidden />}
                  className={cn(!canSend && "bg-muted text-muted-foreground")}
                />
              )}
            </div>
          </div>
        </div>

        <p className="text-caption text-muted-foreground/80 mt-2 text-center">
          ChatGPT can make mistakes. Verify important information.
        </p>
      </div>
    </div>
  );
}
