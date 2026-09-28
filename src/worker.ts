import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";
import {
  buildProjectPlanningConfig,
  isPlanningLeaderEligible,
  PLANNING_LEADER_IDS,
  type ProjectPlanningConfig,
} from "./planning-config.js";

export const PLUGIN_ID = "max.paperclip-plugin";

const PLANNING_NAMESPACE = "planning";
const PLANNING_CONFIG_KEY = "config";
function requiredString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} é obrigatório`);
  }
  return value.trim();
}

function planningStateKey(projectId: string) {
  return {
    scopeKind: "project" as const,
    scopeId: projectId,
    namespace: PLANNING_NAMESPACE,
    stateKey: PLANNING_CONFIG_KEY,
  };
}

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    ctx.data.register("planning-bootstrap", async (params) => {
      const rawCompanyId = params.companyId;
      if (typeof rawCompanyId !== "string" || !rawCompanyId.trim()) {
        return { leaders: [], configurations: {} };
      }
      const companyId = rawCompanyId.trim();
      const projects = await ctx.projects.list({ companyId, limit: 500, offset: 0 });
      const agents = await ctx.agents.list({ companyId, limit: 500, offset: 0 });
      const leaders = agents
        .filter(isPlanningLeaderEligible)
        .map((agent) => ({
          id: agent.id,
          name: agent.name,
          title: agent.title,
          status: agent.status,
        }))
        .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));

      const configurations: Record<string, ProjectPlanningConfig | null> = {};
      await Promise.all(projects.map(async (project) => {
        configurations[project.id] = await ctx.state.get(
          planningStateKey(project.id),
        ) as ProjectPlanningConfig | null;
      }));

      return { leaders, configurations };
    });

    ctx.actions.register("save-planning-config", async (params, actionContext) => {
      const companyId = actionContext.companyId;
      if (!companyId) throw new Error("empresa ativa não identificada");
      const projectId = requiredString(params, "projectId");
      const planningAgentId = requiredString(params, "planningAgentId");
      const project = await ctx.projects.get(projectId, companyId);
      if (!project) throw new Error("projeto não encontrado na empresa ativa");
      const agents = await ctx.agents.list({ companyId, limit: 500, offset: 0 });
      const selected = agents.find((agent) => agent.id === planningAgentId);
      if (!selected || !PLANNING_LEADER_IDS.has(selected.id)) {
        throw new Error("o agente de planejamento deve ser um dos líderes habilitados");
      }
      if (!isPlanningLeaderEligible(selected)) {
        throw new Error("o agente de planejamento precisa estar em estado invocável");
      }

      const config = buildProjectPlanningConfig(planningAgentId);
      await ctx.state.set(planningStateKey(projectId), config);
      return config;
    });

    ctx.logger.info("MaxPaperclipPlugin unificado inicializado com sucesso.");
  },

  async onHealth() {
    return {
      status: "ok",
      message: "MaxPaperclipPlugin operacional (AutoSave, Tradutor, Iconify, Tarefas, Capacidades)",
    };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
