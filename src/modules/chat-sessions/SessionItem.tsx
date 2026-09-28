import React, { useState, useRef, useEffect } from "react";
import { MessageSquare, Edit2, Check, X } from "lucide-react";
import type { ChatSession } from "./types.js";

interface SessionItemProps {
  session: ChatSession;
  isActive: boolean;
  onSelect: (session: ChatSession) => void;
  onRename: (session: ChatSession, newTitle: string) => void;
}

function formatRelativeTime(dateStr: string): string {
  try {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return "agora";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h`;
    const diffDays = Math.floor(diffHour / 24);
    if (diffDays < 7) return `${diffDays}d`;
    return new Date(dateStr).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  } catch {
    return "";
  }
}

export function SessionItem({ session, isActive, onSelect, onRename }: SessionItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(session.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSaveRename = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (editValue.trim() && editValue.trim() !== session.title) {
      onRename(session, editValue.trim());
    }
    setIsEditing(false);
  };

  const handleCancelRename = () => {
    setEditValue(session.title);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <form
        onSubmit={handleSaveRename}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent/60 border border-primary/30"
      >
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") handleCancelRename();
          }}
          className="flex-1 bg-background text-xs px-2 py-1 rounded border border-border outline-none text-foreground"
        />
        <button
          type="submit"
          title="Salvar título"
          className="p-1 hover:text-primary transition-colors text-muted-foreground"
        >
          <Check className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={handleCancelRename}
          title="Cancelar"
          className="p-1 hover:text-destructive transition-colors text-muted-foreground"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </form>
    );
  }

  return (
    <div
      onClick={() => onSelect(session)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(session);
        }
      }}
      className={`group relative flex flex-col gap-1 px-3 py-2.5 rounded-lg cursor-pointer transition-all border text-left ${
        isActive
          ? "bg-accent/80 border-border text-foreground shadow-xs"
          : "bg-transparent hover:bg-muted/40 border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <MessageSquare
            className={`w-3.5 h-3.5 shrink-0 ${
              isActive ? "text-primary" : "text-muted-foreground/70 group-hover:text-foreground"
            }`}
          />
          <span className="font-medium text-xs truncate" title={session.title}>
            {session.title}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] text-muted-foreground/60 whitespace-nowrap">
            {formatRelativeTime(session.updatedAt || session.createdAt)}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setEditValue(session.title);
              setIsEditing(true);
            }}
            title="Renomear sessão"
            className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-foreground text-muted-foreground transition-opacity"
          >
            <Edit2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {session.snippet && (
        <p className="text-[11px] text-muted-foreground/70 line-clamp-1 pl-5">
          {session.snippet}
        </p>
      )}
    </div>
  );
}
