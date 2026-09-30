import React, { useEffect, useState, useRef, useCallback } from "react";
import { Terminal, X, Copy, Check, Trash2, RefreshCw } from "lucide-react";
import { fetchTaskLogs, clearTaskLogs, type TaskLogsResult } from "./api.js";
import type { StatusDeTask, TipoDeTask } from "./tasksJson.js";

interface TaskLogsModalProps {
  open: boolean;
  companyId: string;
  projectId: string;
  projectName: string;
  taskType: TipoDeTask;
  onClose: () => void;
}

export function TaskLogsModal({
  open,
  companyId,
  projectId,
  projectName,
  taskType,
  onClose,
}: TaskLogsModalProps) {
  const [data, setData] = useState<TaskLogsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  const taskTitle = taskType === "dev" ? "NPM RUN DEV" : "NPM RUN BUILD";

  const loadLogs = useCallback(
    async (silent = false) => {
      if (!projectId) return;
      if (!silent) setLoading(true);
      try {
        const result = await fetchTaskLogs(companyId, projectId, taskType);
        if (result) {
          setData(result);
        }
      } catch (err) {
        console.warn("Erro ao buscar logs da task:", err);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [companyId, projectId, taskType]
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async (silent: boolean) => {
      await loadLogs(silent);
      if (!cancelled) timer = setTimeout(() => void poll(true), 2000);
    };

    void poll(false);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, loadLogs]);

  useEffect(() => {
    if (autoScroll && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [data?.logs, autoScroll]);

  // Tecla Escape para fechar
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const handleCopy = async () => {
    if (!data?.logs || data.logs.length === 0) return;
    try {
      await navigator.clipboard.writeText(data.logs.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignora erro
    }
  };

  const handleClear = async () => {
    const cleared = await clearTaskLogs(companyId, projectId, taskType);
    if (cleared) setData((prev) => (prev ? { ...prev, logs: [] } : null));
  };

  if (!open) return null;

  const status: StatusDeTask = data?.status ?? "parado";
  const pid = data?.pid;

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 select-text"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex flex-col w-full max-w-3xl h-[80vh] rounded-xl border border-border bg-card shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Cabeçalho do Modal */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/40 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Terminal className="w-5 h-5 text-primary shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground truncate">
                  Logs da Task: <span className="font-mono text-primary">{taskTitle}</span>
                </h2>
                {/* Badge de Status */}
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                    status === "rodando"
                      ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
                      : status === "erro"
                      ? "bg-rose-500/10 text-rose-500 border-rose-500/30"
                      : "bg-muted text-muted-foreground border-border"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      status === "rodando"
                        ? "bg-emerald-500 animate-pulse"
                        : status === "erro"
                        ? "bg-rose-500"
                        : "bg-muted-foreground"
                    }`}
                  />
                  {status === "rodando"
                    ? `Rodando${pid ? ` (PID: ${pid})` : ""}`
                    : status === "erro"
                    ? "Erro na execução"
                    : "Parado"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground truncate">{projectName}</p>
            </div>
          </div>

          {/* Ações do Topo */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => loadLogs(false)}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors cursor-pointer"
              title="Atualizar logs"
              aria-label="Atualizar logs"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-primary" : ""}`} />
            </button>

            <button
              type="button"
              onClick={handleCopy}
              disabled={!data?.logs?.length}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/50 disabled:opacity-40 transition-colors cursor-pointer"
              title="Copiar todas as linhas"
              aria-label="Copiar logs"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? "Copiado!" : "Copiar"}</span>
            </button>

            <button
              type="button"
              onClick={handleClear}
              disabled={!data?.logs?.length}
              className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-40 transition-colors cursor-pointer"
              title="Limpar logs"
              aria-label="Limpar logs"
            >
              <Trash2 className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 ml-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors cursor-pointer"
              title="Fechar (Esc)"
              aria-label="Fechar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Corpo do Terminal de Logs */}
        <div
          ref={logsContainerRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
            setAutoScroll(isNearBottom);
          }}
          className="flex-1 min-h-0 bg-[#0d1117] text-[#c9d1d9] font-mono text-xs p-4 overflow-y-auto overflow-x-auto space-y-1 select-text leading-relaxed"
        >
          {data?.logs && data.logs.length > 0 ? (
            data.logs.map((line, idx) => {
              const isError =
                line.toLowerCase().includes("error") ||
                line.toLowerCase().includes("erro") ||
                line.toLowerCase().includes("fail") ||
                line.toLowerCase().includes("falha");
              const isInfo = line.startsWith("[MaxPaperclipPlugin]");
              return (
                <div
                  key={idx}
                  className={`whitespace-pre-wrap break-all ${
                    isError
                      ? "text-rose-400 font-semibold"
                      : isInfo
                      ? "text-cyan-400 font-semibold"
                      : "text-zinc-200"
                  }`}
                >
                  {line}
                </div>
              );
            })
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-zinc-500 py-12">
              <Terminal className="w-8 h-8 mb-2 opacity-40" />
              <p>Nenhum log registrado para esta tarefa ainda.</p>
              <p className="text-[11px] text-zinc-600 mt-1">
                Clique no botão de play da task para iniciar a execução e acompanhar as saídas aqui.
              </p>
            </div>
          )}
        </div>

        {/* Rodapé Informativo */}
        <footer className="flex items-center justify-between px-4 py-2 bg-muted/20 border-t border-border text-[11px] text-muted-foreground shrink-0 select-none">
          <div className="flex items-center gap-3">
            <span>Buffer circular: {data?.logs?.length || 0} / 200 linhas</span>
            {data?.startedAt && (
              <span>Iniciado às {new Date(data.startedAt).toLocaleTimeString("pt-BR")}</span>
            )}
          </div>
          <div>
            <span className={autoScroll ? "text-primary" : "text-muted-foreground"}>
              {autoScroll ? "● Auto-scroll ativo" : "○ Auto-scroll pausado"}
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
