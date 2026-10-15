"use client";

import { useEffect, useRef, useState } from "react";

import { motion } from "framer-motion";

import { Button } from "@/components/ui/button";
import { EASE_PREMIUM } from "@/constants/motion";
import { usePrefersReducedMotion } from "@/hooks/use-media-query";
import type { Message } from "@/types/chat";
import { cn } from "@/utils/cn";

import { AttachmentList } from "./file-preview";
import { MessageActions } from "./message-actions";

interface UserMessageProps {
  message: Message;
  showActions: boolean;
  touchLayout: boolean;
  disabled: boolean;
  onEdit: (content: string) => void;
}

export function UserMessage({
  message,
  showActions,
  touchLayout,
  disabled,
  onEdit,
}: UserMessageProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const shouldReduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (!isEditing) return;
    const node = textareaRef.current;
    if (!node) return;

    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [isEditing]);

  const startEditing = () => {
    setDraft(message.content);
    setIsEditing(true);
  };

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === message.content) {
      setIsEditing(false);
      return;
    }
    setIsEditing(false);
    onEdit(trimmed);
  };

  return (
    <motion.article
      initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE_PREMIUM }}
      aria-label="Your message"
      className="group/message flex flex-col items-end gap-1.5"
    >
      {message.attachments?.length ? (
        <AttachmentList attachments={message.attachments} className="mb-0.5" />
      ) : null}

      {isEditing ? (
        <div className="border-ring/50 bg-card shadow-e2 w-full rounded-xl border p-2.5">
          <label htmlFor={`edit-${message.id}`} className="sr-only">
            Edit your message
          </label>
          <textarea
            id={`edit-${message.id}`}
            ref={textareaRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              event.target.style.height = "auto";
              event.target.style.height = `${event.target.scrollHeight}px`;
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setIsEditing(false);
              }
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submit();
              }
            }}
            rows={1}
            className="text-chat text-foreground max-h-64 w-full resize-none bg-transparent px-1 py-0.5 outline-none"
          />

          <div className="mt-2 flex items-center justify-end gap-2">
            <p className="text-caption text-muted-foreground mr-auto hidden sm:block">
              Editing replaces the response below.
            </p>
            <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={submit}
              disabled={!draft.trim() || draft.trim() === message.content}
            >
              Save &amp; resend
            </Button>
          </div>
        </div>
      ) : message.content ? (
        <div
          className={cn(
            "max-w-[85%] whitespace-pre-wrap break-words rounded-xl bg-bubble px-3.5 py-2.5 text-chat text-foreground",
            "sm:max-w-[80%]",
          )}
        >
          {message.content}
        </div>
      ) : null}

      {!isEditing && showActions ? (
        <div className="flex items-center gap-2">
          {message.edited ? (
            <span className="text-caption text-muted-foreground">Edited</span>
          ) : null}
          <MessageActions
            content={message.content}
            alwaysVisible={touchLayout}
            disabled={disabled}
            onEdit={startEditing}
          />
        </div>
      ) : null}
    </motion.article>
  );
}
