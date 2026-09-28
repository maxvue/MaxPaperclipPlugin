import React, { useEffect } from "react";
import { Trash2, AlertTriangle, X } from "lucide-react";
import type { IssueSummary } from "./types.js";

interface TaskDeleteConfirmModalProps {
  isOpen: boolean;
  task: IssueSummary | null;
  subtasksCount: number;
  loading?: boolean;
  onConfirmCascade: () => void;
  onConfirmSingle: () => void;
  onCancel: () => void;
}

export function TaskDeleteConfirmModal({
  isOpen,
  task,
  subtasksCount,
  loading = false,
  onConfirmCascade,
  onConfirmSingle,
  onCancel,
}: TaskDeleteConfirmModalProps) {
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

  if (!isOpen || !task) return null;

  const hasSubtasks = subtasksCount > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-modal-title"
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
            <AlertTriangle className="h-5 w-5" />
          </div>

          <div className="min-w-0 flex-1">
            <h3 id="delete-modal-title" className="text-sm font-semibold leading-6 text-foreground">
              {hasSubtasks ? "Remover tarefa e subtarefas vinculadas?" : "Excluir tarefa permanentemente?"}
            </h3>

            <div className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {hasSubtasks ? (
                <>
                  <p>
                    A tarefa <strong className="text-foreground">{task.identifier ? `[${task.identifier}] ` : ""}{task.title}</strong> possui{" "}
                    <strong className="text-rose-600 dark:text-rose-400 font-semibold">{subtasksCount} subtarefa(s) vinculada(s)</strong>.
                  </p>
                  <p className="mt-2 text-muted-foreground/90">
                    Deseja remover <strong>todas as tarefas vinculadas</strong> permanentemente ou cancelar a operação?
                  </p>
                </>
              ) : (
                <p>
                  Tem certeza de que deseja remover permanentemente a tarefa{" "}
                  <strong className="text-foreground">{task.identifier ? `[${task.identifier}] ` : ""}{task.title}</strong>?
                  Esta ação é irreversível e excluirá todos os dados e anexos vinculados.
                </p>
              )}
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

          {hasSubtasks ? (
            <button
              type="button"
              onClick={onConfirmCascade}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-rose-600 hover:bg-rose-700 text-white transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {loading ? "Removendo..." : "Remover Todas"}
            </button>
          ) : (
            <button
              type="button"
              onClick={onConfirmSingle}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-rose-600 hover:bg-rose-700 text-white transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {loading ? "Removendo..." : "Remover"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
