import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";
import {
  buildProjectPlanningConfig,
  isPlanningLeaderEligible,
  type ProjectPlanningConfig,
} from "./planning-config.js";
import { taskProcessManager } from "./modules/tasks/processManager.js";
import { extrairRaizDoProjeto, type TipoDeTask } from "./modules/tasks/tasksJson.js";

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

function requiredCompanyId(companyId: string | null): string {
  if (!companyId) throw new Error("empresa ativa não identificada");
  return companyId;
}

function requiredTaskType(params: Record<string, unknown>): TipoDeTask {
  const rawTaskType = requiredString(params, "taskType");
  if (rawTaskType !== "dev" && rawTaskType !== "build") {
    throw new Error("taskType inválido (deve ser 'dev' ou 'build')");
  }
  return rawTaskType;
}

function requiredTaskAction(params: Record<string, unknown>): "start" | "stop" | "toggle" {
  const action = typeof params.action === "string" ? params.action : "toggle";
  if (action !== "start" && action !== "stop" && action !== "toggle") {
    throw new Error("action inválida (deve ser 'start', 'stop' ou 'toggle')");
  }
  return action;
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
      if (!selected || !isPlanningLeaderEligible(selected)) {
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
      const companyId = requiredCompanyId(actionContext.companyId);
      const projectId = requiredString(params, 'projectId');
      const taskType = requiredTaskType(params);
      const action = requiredTaskAction(params);

      const project = await ctx.projects.get(projectId, companyId);
      if (!project) throw new Error('projeto não encontrado na empresa ativa');
      const projectName = project.name;
      const currentStatus = taskProcessManager.getProcessStatus(companyId, projectId, taskType).status;
      if (action === 'stop' || (action === 'toggle' && currentStatus === 'rodando')) {
        return await taskProcessManager.executeTask({
          companyId,
          projectId,
          projectName,
          taskType,
          action,
        });
      }
      const workspace = await ctx.projects.getPrimaryWorkspace(projectId, companyId);
      const rootDir = workspace?.path?.replace(/[/\\]+$/, "") || extrairRaizDoProjeto(project);

      if (!rootDir) {
        return taskProcessManager.registrarFalhaDeExecucao(
          companyId,
          projectId,
          taskType,
          `Não foi possível determinar o diretório raiz local do projeto ${projectId}`,
          projectName
        );
      }

      return await taskProcessManager.executeTask({
        companyId,
        projectId,
        projectName,
        rootDir,
        taskType,
        action,
      });
    });

    ctx.actions.register("task-manager:status", async (_params, actionContext) => {
      const companyId = requiredCompanyId(actionContext.companyId);
      return taskProcessManager.getAllStatuses(companyId);
    });

    ctx.actions.register("task-manager:logs", async (params, actionContext) => {
      const companyId = requiredCompanyId(actionContext.companyId);
      const projectId = requiredString(params, "projectId");
      const taskType = requiredTaskType(params);
      const project = await ctx.projects.get(projectId, companyId);
      if (!project) throw new Error("projeto não encontrado na empresa ativa");
      return taskProcessManager.getLogs(companyId, projectId, taskType);
    });

    ctx.actions.register("task-manager:clear-logs", async (params, actionContext) => {
      const companyId = requiredCompanyId(actionContext.companyId);
      const projectId = requiredString(params, "projectId");
      const taskType = requiredTaskType(params);
      const project = await ctx.projects.get(projectId, companyId);
      if (!project) throw new Error("projeto não encontrado na empresa ativa");
      taskProcessManager.clearLogs(companyId, projectId, taskType);
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

  async onShutdown() {
    await taskProcessManager.stopAll();
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
