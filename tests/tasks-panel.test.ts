import { describe, it, expect, beforeEach, vi } from "vitest";
import { sidebarStore } from "../src/modules/tasks/store.js";
import { getTaskStatusLabel, getTaskStatusColorClass } from "../src/modules/tasks/status.js";
import { deleteIssueCascade, unarchiveIssue } from "../src/modules/tasks/api.js";
import type { IssueSummary, ProjectSummary } from "../src/modules/tasks/types.js";

describe("Módulo de Tarefas - Painel estilo MaxCode", () => {
  beforeEach(() => {
    // Limpa estado do store e localStorage entre os testes
    sidebarStore.clearHiddenTasks();
    sidebarStore.clearHiddenProjects();
    sidebarStore.setProjectsOrder([]);
    sidebarStore.setExibindoArquivados(false);
    if (typeof window !== "undefined") {
      window.localStorage.clear();
    }
  });

  describe("1. Agrupamento por Projetos e Subtarefas", () => {
    const mockProjects: ProjectSummary[] = [
      { id: "proj-1", companyId: "comp-1", name: "EngeApp", color: "#3b82f6" },
      { id: "proj-2", companyId: "comp-1", name: "MaxComponentsUi", color: "#10b981" },
    ];

    const mockTasks: IssueSummary[] = [
      {
        id: "task-1",
        companyId: "comp-1",
        projectId: "proj-1",
        title: "Criar layout compacto",
        status: "in_progress",
        priority: "high",
        identifier: "ENG-10",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "task-1-sub-1",
        companyId: "comp-1",
        projectId: "proj-1",
        parentId: "task-1",
        title: "Subtarefa: Ícones de status",
        status: "done",
        priority: "medium",
        identifier: "ENG-11",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "task-2",
        companyId: "comp-1",
        projectId: "proj-2",
        title: "Ajustar tema escuro",
        status: "todo",
        priority: "low",
        identifier: "MAX-01",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "task-3",
        companyId: "comp-1",
        projectId: null, // Sem projeto
        title: "Revisão geral da documentação",
        status: "in_review",
        priority: "low",
        identifier: "DOC-01",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    it("deve separar corretamente tarefas raiz e subtarefas por parentId", () => {
      const roots: IssueSummary[] = [];
      const subMap = new Map<string, IssueSummary[]>();

      for (const t of mockTasks) {
        if (t.parentId) {
          const list = subMap.get(t.parentId) || [];
          list.push(t);
          subMap.set(t.parentId, list);
        } else {
          roots.push(t);
        }
      }

      expect(roots).toHaveLength(3);
      expect(roots.map((r) => r.id)).toEqual(["task-1", "task-2", "task-3"]);

      const task1Subs = subMap.get("task-1");
      expect(task1Subs).toBeDefined();
      expect(task1Subs).toHaveLength(1);
      expect(task1Subs?.[0].title).toBe("Subtarefa: Ícones de status");
    });

    it("deve agrupar tarefas raiz por projeto e identificar tarefas sem projeto", () => {
      const roots = mockTasks.filter((t) => !t.parentId);
      const projMap = new Map<string, IssueSummary[]>();
      const unassigned: IssueSummary[] = [];

      for (const t of roots) {
        if (t.projectId) {
          const list = projMap.get(t.projectId) || [];
          list.push(t);
          projMap.set(t.projectId, list);
        } else {
          unassigned.push(t);
        }
      }

      expect(projMap.get("proj-1")).toHaveLength(1);
      expect(projMap.get("proj-2")).toHaveLength(1);
      expect(unassigned).toHaveLength(1);
      expect(unassigned[0].id).toBe("task-3");
    });
  });

  describe("2. Rótulos e Cores de Status Canônicos", () => {
    it("deve retornar rótulos em Português do Brasil corretos para os status", () => {
      expect(getTaskStatusLabel("in_progress")).toBe("Em andamento");
      expect(getTaskStatusLabel("todo")).toBe("A fazer");
      expect(getTaskStatusLabel("done")).toBe("Concluída");
      expect(getTaskStatusLabel("in_review")).toBe("Em revisão");
      expect(getTaskStatusLabel("blocked")).toBe("Bloqueada");
      expect(getTaskStatusLabel("cancelled")).toBe("Cancelada");
      expect(getTaskStatusLabel("backlog")).toBe("Backlog");
    });

    it("deve mapear as classes Tailwind canônicas do Paperclip para cada status", () => {
      expect(getTaskStatusColorClass("in_progress")).toContain("text-blue-600");
      expect(getTaskStatusColorClass("todo")).toContain("text-amber-600");
      expect(getTaskStatusColorClass("done")).toContain("text-emerald-600");
      expect(getTaskStatusColorClass("in_review")).toContain("text-purple-600");
      expect(getTaskStatusColorClass("blocked")).toContain("text-rose-600");
    });
  });

  describe("3. Tarefas Ocultas e Persistência", () => {
    it("deve alternar e persistir o estado de tarefas ocultas", () => {
      expect(sidebarStore.isTaskHidden("task-123")).toBe(false);

      // Oculta tarefa
      sidebarStore.hideTask("task-123");
      expect(sidebarStore.isTaskHidden("task-123")).toBe(true);
      expect(sidebarStore.getSnapshot().hiddenTaskIds.has("task-123")).toBe(true);

      // Desoculta tarefa
      sidebarStore.unhideTask("task-123");
      expect(sidebarStore.isTaskHidden("task-123")).toBe(false);
      expect(sidebarStore.getSnapshot().hiddenTaskIds.has("task-123")).toBe(false);
    });

    it("deve limpar todas as tarefas ocultas com clearHiddenTasks", () => {
      sidebarStore.hideTask("t1");
      sidebarStore.hideTask("t2");
      expect(sidebarStore.getSnapshot().hiddenTaskIds.size).toBe(2);

      sidebarStore.clearHiddenTasks();
      expect(sidebarStore.getSnapshot().hiddenTaskIds.size).toBe(0);
    });
  });

  describe("4. Colapso de Projetos no Painel", () => {
    it("deve colapsar e expandir projetos individualmente", () => {
      expect(sidebarStore.isProjectCollapsed("proj-alpha")).toBe(false);

      sidebarStore.toggleProjectCollapsed("proj-alpha");
      expect(sidebarStore.isProjectCollapsed("proj-alpha")).toBe(true);

      sidebarStore.toggleProjectCollapsed("proj-alpha");
      expect(sidebarStore.isProjectCollapsed("proj-alpha")).toBe(false);
    });
  });

  describe("5. Exclusão em Cascata e Vínculos", () => {
    it("deve chamar a remoção das tarefas filhas primeiro antes da tarefa pai", async () => {
      const calls: string[] = [];

      // Intercepta globalThis.fetch para validar a ordem exata das chamadas
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          calls.push(url);
          return {
            ok: true,
            status: 200,
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => ({ ok: true }),
          } as unknown as Response;
        }
        return { ok: true, json: async () => ({}) } as unknown as Response;
      });

      try {
        const parentId = "parent-task";
        const childIds = ["child-1", "child-2"];

        const success = await deleteIssueCascade(parentId, childIds);
        expect(success).toBe(true);

        // Verifica que as filhas foram removidas antes do pai
        expect(calls).toEqual([
          "/api/issues/child-1",
          "/api/issues/child-2",
          "/api/issues/parent-task",
        ]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("6. Ocultação e Restauração de Projetos (Fase 2)", () => {
    it("deve ocultar e desocultar projetos individualmente", () => {
      expect(sidebarStore.isProjectHidden("proj-1")).toBe(false);

      sidebarStore.hideProject("proj-1");
      expect(sidebarStore.isProjectHidden("proj-1")).toBe(true);
      expect(sidebarStore.getSnapshot().hiddenProjectIds.has("proj-1")).toBe(true);

      sidebarStore.unhideProject("proj-1");
      expect(sidebarStore.isProjectHidden("proj-1")).toBe(false);
      expect(sidebarStore.getSnapshot().hiddenProjectIds.has("proj-1")).toBe(false);
    });

    it("deve limpar todos os projetos ocultos com clearHiddenProjects", () => {
      sidebarStore.hideProject("p1");
      sidebarStore.hideProject("p2");
      expect(sidebarStore.getSnapshot().hiddenProjectIds.size).toBe(2);

      sidebarStore.clearHiddenProjects();
      expect(sidebarStore.getSnapshot().hiddenProjectIds.size).toBe(0);
    });
  });

  describe("7. Ordenação Manual de Projetos (Fase 2)", () => {
    it("deve reordenar projetos para cima e para baixo entre os visíveis", () => {
      const allProjects = ["proj-a", "proj-b", "proj-c"];
      const visibleProjects = ["proj-a", "proj-b", "proj-c"];

      // Move proj-b para cima (-1)
      sidebarStore.moveProject("proj-b", -1, visibleProjects, allProjects);
      expect(sidebarStore.getSnapshot().projectsOrder).toEqual(["proj-b", "proj-a", "proj-c"]);

      // Move proj-b para baixo (1)
      sidebarStore.moveProject("proj-b", 1, ["proj-b", "proj-a", "proj-c"], allProjects);
      expect(sidebarStore.getSnapshot().projectsOrder).toEqual(["proj-a", "proj-b", "proj-c"]);
    });
  });

  describe("8. Alternância entre Modo Ativo e Arquivados (Fase 2)", () => {
    it("deve alternar estado de exibindoArquivados", () => {
      expect(sidebarStore.getSnapshot().exibindoArquivados).toBe(false);

      sidebarStore.toggleExibindoArquivados();
      expect(sidebarStore.getSnapshot().exibindoArquivados).toBe(true);

      sidebarStore.toggleExibindoArquivados();
      expect(sidebarStore.getSnapshot().exibindoArquivados).toBe(false);
    });

    it("deve chamar endpoint de desarquivamento unarchiveIssue", async () => {
      const originalFetch = globalThis.fetch;
      let patchUrl = "";
      let patchBody: unknown = null;

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          patchUrl = url;
          patchBody = JSON.parse(init.body as string);
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ ok: true }),
        } as unknown as Response;
      });

      try {
        const success = await unarchiveIssue("issue-99");
        expect(success).toBe(true);
        expect(patchUrl).toBe("/api/issues/issue-99");
        expect(patchBody).toEqual({ hiddenAt: null });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("9. Execução de Tasks NPM RUN DEV e NPM RUN BUILD (Fase 2)", () => {
    it("deve alternar os estados de dev e build por projeto", () => {
      expect(sidebarStore.getSnapshot().runDevStates["proj-x"]).toBeUndefined();

      sidebarStore.toggleRunDev("proj-x");
      expect(sidebarStore.getSnapshot().runDevStates["proj-x"]).toBe("rodando");

      sidebarStore.toggleRunDev("proj-x");
      expect(sidebarStore.getSnapshot().runDevStates["proj-x"]).toBe("parado");

      sidebarStore.toggleRunBuild("proj-x");
      expect(sidebarStore.getSnapshot().runBuildStates["proj-x"]).toBe("rodando");

      sidebarStore.toggleRunBuild("proj-x");
      expect(sidebarStore.getSnapshot().runBuildStates["proj-x"]).toBe("parado");
    });
  });
});
