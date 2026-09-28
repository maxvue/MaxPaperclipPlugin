import React, { useEffect } from "react";
import { Trash2, AlertTriangle, X } from "lucide-react";
import type { ChatSession } from "./types.js";

interface SessionDeleteConfirmModalProps {
  isOpen: boolean;
  session: ChatSession | null;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SessionDeleteConfirmModal({
  isOpen,
  session,
  loading = false,
  onConfirm,
  onCancel,
}: SessionDeleteConfirmModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, loading, onCancel]);

  if (!isOpen || !session) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-session-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) {
          onCancel();
        }
      }}
    >
      <div className="relative w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-2xl text-foreground select-none">
        {/* Botão Fechar no Canto Superior */}
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="absolute right-3.5 top-3.5 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors cursor-pointer"
          title="Fechar (Esc)"
          aria-label="Fechar diálogo de confirmação"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Cabeçalho com Ícone de Alerta */}
        <div className="flex items-start gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400">
            <Trash2 className="h-5 w-5" />
          </div>

          <div className="min-w-0 flex-1">
            <h3 id="delete-session-modal-title" className="text-sm font-semibold leading-6 text-foreground">
              Remover conversa definitivamente?
            </h3>

            <div className="mt-2 text-xs leading-relaxed text-muted-foreground space-y-1.5">
              <p>
                Tem certeza de que deseja remover permanentemente a conversa{" "}
                <strong className="text-foreground">"{session.title}"</strong>?
              </p>
              {session.messagesCount > 0 && (
                <p className="text-muted-foreground/80">
                  Esta conversa contém{" "}
                  <strong className="text-foreground font-medium">{session.messagesCount} mensagem(ns)</strong> associada(s).
                </p>
              )}
              <p className="text-rose-500/90 dark:text-rose-400/90 text-[11px] font-medium pt-1">
                Esta ação removerá a conversa definitivamente da sua lista.
              </p>
            </div>
          </div>
        </div>

        {/* Botões de Ação */}
        <div className="mt-5 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-border/80 bg-background text-foreground hover:bg-accent/40 transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-rose-600 hover:bg-rose-700 text-white transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Remover Definitivamente</span>
          </button>
        </div>
      </div>
    </div>
  );
}
