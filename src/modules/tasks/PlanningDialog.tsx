import React, { useEffect, useMemo, useState } from "react";
import { Bot, Loader2, X } from "lucide-react";
import { usePluginAction } from "@paperclipai/plugin-sdk/ui";
import type { IssueSummary, PlanningBootstrap, ProjectSummary } from "./types.js";
import { buildPlanningPrompt, createPlanningSessionId, startPlanningConversation } from "./planning.js";

interface PlanningDialogProps {
  open: boolean;
  companyId: string;
  companyPrefix: string;
  project: ProjectSummary | null;
  sourceTask?: IssueSummary | null;
  configurationOnly?: boolean;
  bootstrap?: PlanningBootstrap | null;
  onClose(): void;
  onSaved(): Promise<void> | void;
}

export function PlanningDialog(props: PlanningDialogProps) {
  const saveConfig = usePluginAction("save-planning-config");
  const configuredAgent = props.project
    ? props.bootstrap?.configurations[props.project.id]?.planningAgentId
    : null;
  const defaultAgent = configuredAgent ?? props.project?.leadAgentId ?? "";
  const [agentId, setAgentId] = useState(defaultAgent);
  const [intention, setIntention] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setAgentId(defaultAgent);
    setIntention("");
    setError(null);
  }, [props.open, defaultAgent, props.project?.id, props.sourceTask?.id]);

  const selectedIsEligible = useMemo(
    () => props.bootstrap?.leaders.some((leader) => leader.id === agentId) ?? false,
    [props.bootstrap, agentId],
  );

  if (!props.open || !props.project) return null;

  const submit = async () => {
    if (!agentId || !selectedIsEligible) {
      setError("Selecione um líder ativo para o planejamento.");
      return;
    }
    if (!props.configurationOnly && !intention.trim()) {
      setError("Descreva a intenção inicial.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (configuredAgent !== agentId) {
        await saveConfig({ projectId: props.project!.id, planningAgentId: agentId });
        await props.onSaved();
      }
      if (props.configurationOnly) {
        props.onClose();
        setSubmitting(false);
        return;
      }
      const url = await startPlanningConversation({
        companyId: props.companyId,
        companyPrefix: props.companyPrefix,
        agentId,
        prompt: buildPlanningPrompt({
          sessionId: createPlanningSessionId(),
          project: props.project!,
          intention,
          sourceTask: props.sourceTask,
        }),
      });
      window.location.assign(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível iniciar o planejamento.");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-xl rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <div>
              <h2 className="text-sm font-semibold">
                {props.configurationOnly
                  ? "Configurar planejamento"
                  : props.sourceTask
                    ? "Planejar a partir desta tarefa"
                    : "Planejar tarefa"}
              </h2>
              <p className="text-xs text-muted-foreground">{props.project.name}</p>
            </div>
          </div>
          <button type="button" onClick={props.onClose} className="rounded p-1 text-muted-foreground hover:bg-accent" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-4">
          {!props.configurationOnly && props.sourceTask && (
            <div className="rounded-md border border-border/60 bg-muted/30 p-2 text-xs">
              <span className="font-mono text-muted-foreground">{props.sourceTask.identifier}</span>{" "}
              <span className="font-medium">{props.sourceTask.title}</span>
            </div>
          )}
          <label className="block space-y-1.5 text-xs font-medium">
            Líder de planejamento
            <select value={agentId} onChange={(event) => setAgentId(event.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
              <option value="">Selecione um líder</option>
              {(props.bootstrap?.leaders ?? []).map((leader) => (
                <option key={leader.id} value={leader.id}>{leader.name}{leader.title ? ` — ${leader.title}` : ""}</option>
              ))}
            </select>
          </label>
          {!props.configurationOnly && (
            <>
              <label className="block space-y-1.5 text-xs font-medium">
                Intenção inicial
                <textarea value={intention} onChange={(event) => setIntention(event.target.value)} rows={6} maxLength={6000} placeholder="Descreva o resultado que deseja alcançar..." className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm" />
              </label>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                O líder fará perguntas progressivas. Nenhuma execução será iniciada antes da aprovação explícita do escopo e do plano técnico.
              </p>
            </>
          )}
          {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={props.onClose} disabled={submitting} className="rounded-md border border-border px-3 py-2 text-xs">Cancelar</button>
          <button type="button" onClick={submit} disabled={submitting} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50">
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {props.configurationOnly ? "Salvar configuração" : "Iniciar planejamento"}
          </button>
        </div>
      </div>
    </div>
  );
}
