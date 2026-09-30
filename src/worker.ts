import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";
import {
  buildProjectPlanningConfig,
  isPlanningLeaderEligible,
  PLANNING_LEADER_IDS,
  type ProjectPlanningConfig,
} from "./planning-config.js";
import { taskProcessManager } from "./modules/tasks/processManager.js";
import type { TipoDeTask } from "./modules/tasks/tasksJson.js";

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

export function extrairRaizDoProjeto(project: unknown): string | null {
  if (!project || typeof project !== "object") return null;
  const p = project as Record<string, unknown>;
  const codebase = p.codebase as Record<string, unknown> | undefined;
  const primaryWorkspace = p.primaryWorkspace as Record<string, unknown> | undefined;
  const workspaces = Array.isArray(p.workspaces) ? p.workspaces : [];

  const candidate =
    (typeof codebase?.effectiveLocalFolder === "string" && codebase.effectiveLocalFolder) ||
    (typeof codebase?.localFolder === "string" && codebase.localFolder) ||
    (typeof primaryWorkspace?.cwd === "string" && primaryWorkspace.cwd) ||
    (workspaces.length > 0 &&
      typeof (workspaces[0] as Record<string, unknown>)?.cwd === "string" &&
      ((workspaces[0] as Record<string, unknown>).cwd as string)) ||
    null;

  if (!candidate || typeof candidate !== "string") return null;
  return candidate.replace(/[/\\]+$/, "");
}

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    // -------------------------------------------------------------
    // Planning Data & Actions
    // -------------------------------------------------------------
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
      await Promise.all(
        projects.map(async (project) => {
          configurations[project.id] = (await ctx.state.get(
            planningStateKey(project.id)
          )) as ProjectPlanningConfig | null;
        })
      );

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

    // -------------------------------------------------------------
    // Task Manager Actions & Data (Execução de tasks .vscode estilo MaxCode)
    // -------------------------------------------------------------
    ctx.actions.register("task-manager:execute", async (params, actionContext) => {
      let companyId =
        (typeof params.companyId === "string" && params.companyId.trim()) ||
        actionContext.companyId;
      const projectId = requiredString(params, "projectId");
      const rawTaskType = requiredString(params, "taskType");
      if (rawTaskType !== "dev" && rawTaskType !== "build") {
        throw new Error("taskType inválido (deve ser 'dev' ou 'build')");
      }
      const taskType = rawTaskType as TipoDeTask;
      const action =
        typeof params.action === "string"
          ? (params.action as "start" | "stop" | "toggle")
          : "toggle";

      let rootDir = typeof params.rootDir === "string" ? params.rootDir.trim() : "";
      let projectName: string | undefined =
        typeof params.projectName === "string" && params.projectName.trim()
          ? params.projectName.trim()
          : undefined;

      // 1. Tenta buscar direto se já temos companyId
      if (!rootDir && companyId) {
        try {
          const project = await ctx.projects.get(projectId, companyId);
          if (project) {
            if (!projectName) projectName = (project as unknown as { name?: string }).name;
            const extracted = extrairRaizDoProjeto(project);
            if (extracted) rootDir = extracted;
          }
        } catch {
          // ignora
        }
      }

      // 2. Tenta listar projetos da empresa se ainda não encontrou a raiz
      if (!rootDir && companyId) {
        try {
          const allProjects = await ctx.projects.list({ companyId, limit: 500 });
          const p = allProjects.find((x) => x.id === projectId);
          if (p) {
            if (!projectName) projectName = (p as unknown as { name?: string }).name;
            const extracted = extrairRaizDoProjeto(p);
            if (extracted) rootDir = extracted;
          }
        } catch {
          // ignora
        }
      }

      // 3. Fallback defensivo: se companyId não estiver presente, localiza o projeto varrendo as empresas
      if (!rootDir && !companyId) {
        try {
          const companies = await ctx.companies.list({});
          for (const c of companies) {
            try {
              const project = await ctx.projects.get(projectId, c.id);
              if (project) {
                companyId = c.id;
                if (!projectName) projectName = (project as unknown as { name?: string }).name;
                const extracted = extrairRaizDoProjeto(project);
                if (extracted) {
                  rootDir = extracted;
                  break;
                }
              }
            } catch {
              // continua na próxima empresa
            }
          }
        } catch {
          // ignora
        }
      }

      if (!rootDir) {
        throw new Error(
          `Não foi possível determinar o diretório raiz local do projeto ${projectId}`
        );
      }

      return await taskProcessManager.executeTask({
        projectId,
        projectName,
        rootDir,
        taskType,
        action,
      });
    });

    const handleStatuses = async () => {
      return taskProcessManager.getAllStatuses();
    };
    ctx.actions.register("task-manager:status", handleStatuses);
    ctx.data.register("task-manager:status", handleStatuses);

    const handleLogs = async (params: Record<string, unknown>) => {
      const projectId = requiredString(params, "projectId");
      const rawTaskType = requiredString(params, "taskType");
      if (rawTaskType !== "dev" && rawTaskType !== "build") {
        throw new Error("taskType inválido (deve ser 'dev' ou 'build')");
      }
      return taskProcessManager.getLogs(projectId, rawTaskType as TipoDeTask);
    };
    ctx.actions.register("task-manager:logs", handleLogs);
    ctx.data.register("task-manager:logs", handleLogs);

    ctx.actions.register("task-manager:clear-logs", async (params) => {
      const projectId = requiredString(params, "projectId");
      const rawTaskType = requiredString(params, "taskType");
      taskProcessManager.clearLogs(projectId, rawTaskType as TipoDeTask);
      return { success: true };
    });

    ctx.logger.info("MaxPaperclipPlugin unificado inicializado com sucesso (Task Manager ativo).");
  },

  async onHealth() {
    return {
      status: "ok",
      message: "MaxPaperclipPlugin operacional (AutoSave, Tradutor, Iconify, Tarefas, Capacidades, TaskManager)",
    };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
