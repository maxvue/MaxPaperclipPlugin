import { type PluginDetailTabProps } from "@paperclipai/plugin-sdk/ui";
import React, { useCallback, useEffect, useState } from "react";
import { getSettings, subscribeSettings } from "../../config/settings.js";

type AgentResponse = {
  capabilities?: string | null;
};

function agentPath(agentId: string, companyId: string) {
  return `/api/agents/${encodeURIComponent(agentId)}?companyId=${encodeURIComponent(companyId)}`;
}

async function readError(response: Response) {
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    return body.error ?? body.message ?? `Erro HTTP ${response.status}`;
  } catch {
    return `Erro HTTP ${response.status}`;
  }
}

async function fetchAgent(agentId: string, companyId: string) {
  const response = await fetch(agentPath(agentId, companyId), { credentials: "include" });
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<AgentResponse>;
}

async function saveCapabilities(agentId: string, companyId: string, capabilities: string) {
  const response = await fetch(agentPath(agentId, companyId), {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ capabilities: capabilities.trim() || null }),
  });
  if (!response.ok) throw new Error(await readError(response));
}

function AgentCapabilitiesEditor({ agentId, companyId }: { agentId: string; companyId: string }) {
  const [value, setValue] = useState("");
  const [initialValue, setInitialValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const agent = await fetchAgent(agentId, companyId);
      const capabilities = agent.capabilities ?? "";
      setValue(capabilities);
      setInitialValue(capabilities);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar as capacidades.");
    } finally {
      setLoading(false);
    }
  }, [agentId, companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await saveCapabilities(agentId, companyId, value);
      const saved = value.trim();
      setValue(saved);
      setInitialValue(saved);
      setNotice("Capacidades salvas. A aba Visão geral refletirá a mudança ao ser recarregada.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar as capacidades.");
    } finally {
      setSaving(false);
    }
  }, [agentId, companyId, value]);

  const discard = useCallback(() => {
    setValue(initialValue);
    setError(null);
    setNotice(null);
  }, [initialValue]);

  if (loading) return <p className="text-sm text-muted-foreground p-4">Carregando capacidades do agente…</p>;

  return (
    <section className="w-full space-y-4 p-4">
      <h2 className="text-xl font-semibold">Capacidades</h2>

      <label className="grid gap-1">
        <span className="text-xs text-muted-foreground">Resumo das capacidades do agente</span>
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={saving}
          rows={9}
          placeholder="Ex.: Especialista em Laravel, Vue 3, TypeScript, testes e revisão de código."
          className="flex min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ boxSizing: "border-box", resize: "vertical" }}
        />
      </label>

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

      <footer className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background py-4">
        <p role="status" className="text-xs text-muted-foreground">
          {saving ? "Salvando alterações…" : notice ?? ""}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={discard}
            disabled={saving || value === initialValue}
            className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            Descartar
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || value === initialValue}
            className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          >
            Salvar alterações
          </button>
        </div>
      </footer>
    </section>
  );
}

export function AgentCapabilitiesPanel({ context }: PluginDetailTabProps) {
  const [moduleEnabled, setModuleEnabled] = useState(() => getSettings().capabilities);

  useEffect(() => {
    return subscribeSettings((settings) => {
      setModuleEnabled(settings.capabilities);
    });
  }, []);

  if (!moduleEnabled) return null;

  if (!context?.companyId || !context?.entityId) {
    return <p role="alert" className="text-sm text-muted-foreground p-4">Não foi possível identificar o agente atual.</p>;
  }

  return <AgentCapabilitiesEditor agentId={context.entityId} companyId={context.companyId} />;
}
