import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  despojarComentariosJsonc,
  rotuloEhDoTipo,
  resolverVariaveisTask,
  lerTaskDeclaradaNoConteudo,
  obterTaskFallback,
  resolverTaskEfetiva,
  extrairRaizDoProjeto,
} from "../src/modules/tasks/tasksJson.js";
import {
  criarAmbienteTask,
  montarComandoShell,
  TaskProcessManager,
} from "../src/modules/tasks/processManager.js";
import { sidebarStore } from "../src/modules/tasks/store.js";
import {
  executeProjectTask,
  fetchTaskStatuses,
  fetchTaskLogs,
  clearTaskLogs,
  fetchCompanyTasks,
  fetchCompanyProjects,
  deleteIssueCascade,
} from "../src/modules/tasks/api.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("Execução de Tasks .vscode no MaxPaperclipPlugin (Estilo MaxCode)", () => {
  describe("1. Parser JSONC e Remoção de Comentários (tasksJson.ts)", () => {
    it("deve remover comentários // e /* */ preservando strings e URLs", () => {
      const jsonc = `
        {
          // Comentário de linha única
          "version": "2.0.0",
          /* Comentário
             em bloco */
          "tasks": [
            {
              "label": "npm: dev",
              "command": "http://localhost:3000 // isso não é comentário",
            },
          ]
        }
      `;
      const limpo = despojarComentariosJsonc(jsonc);
      expect(limpo).not.toContain("// Comentário de linha única");
      expect(limpo).not.toContain("/* Comentário");
      expect(limpo).toContain("http://localhost:3000 // isso não é comentário");

      const parsed = JSON.parse(limpo);
      expect(parsed.version).toBe("2.0.0");
      expect(parsed.tasks).toHaveLength(1);
    });

    it("deve remover vírgulas trailing antes de fechar chaves e colchetes", () => {
      const jsonc = `{"tasks": [{"label": "DEV",},],}`;
      const limpo = despojarComentariosJsonc(jsonc);
      const parsed = JSON.parse(limpo);
      expect(parsed.tasks[0].label).toBe("DEV");
    });
  });

  describe("2. Reconhecimento de Rótulos Canônicos (rotuloEhDoTipo)", () => {
    it("deve reconhecer todos os rótulos aceitos de dev", () => {
      expect(rotuloEhDoTipo("RUN DEV", "dev")).toBe(true);
      expect(rotuloEhDoTipo("npm run dev", "dev")).toBe(true);
      expect(rotuloEhDoTipo("  DEV  ", "dev")).toBe(true);
      expect(rotuloEhDoTipo("DEV SERVER", "dev")).toBe(false);
    });

    it("deve reconhecer todos os rótulos aceitos de build", () => {
      expect(rotuloEhDoTipo("RUN BUILD", "build")).toBe(true);
      expect(rotuloEhDoTipo("NPM RUN BUILD", "build")).toBe(true);
      expect(rotuloEhDoTipo("build", "build")).toBe(true);
      expect(rotuloEhDoTipo("BUILD ALL", "build")).toBe(false);
    });
  });

  describe("3. Resolução de Variáveis e Fallback Seguro", () => {
    it("deve substituir variáveis ${workspaceFolder}, ${workspaceRoot} e ${workspaceFolderBasename}", () => {
      const raiz = "/home/usuario/projetos/meu-app";
      const cwdEfetivo = "/home/usuario/projetos/meu-app/subpasta";

      const resultado = resolverVariaveisTask(
        "${workspaceFolderBasename} rodando em ${workspaceFolder} / ${cwd}",
        raiz,
        cwdEfetivo
      );

      expect(resultado).toBe("meu-app rodando em /home/usuario/projetos/meu-app/subpasta / /home/usuario/projetos/meu-app/subpasta");
    });

    it("deve retornar fallback padrão quando o conteúdo é vazio ou não possui a task", () => {
      const fallbackDev = resolverTaskEfetiva("", "/meu-projeto", "dev");
      expect(fallbackDev).toEqual({
        rotulo: "NPM RUN DEV",
        tipo: "shell",
        command: "npm run dev",
        cwd: "/meu-projeto",
      });

      const fallbackBuild = resolverTaskEfetiva(null, "/meu-projeto", "build");
      expect(fallbackBuild).toEqual({
        rotulo: "NPM RUN BUILD",
        tipo: "shell",
        command: "npm run build",
        cwd: "/meu-projeto",
      });
    });

    it("deve extrair e resolver corretamente uma task declarada em tasks.json", () => {
      const tasksJson = `
        {
          "version": "2.0.0",
          "tasks": [
            {
              "label": "NPM RUN DEV",
              "type": "shell",
              "command": "vite",
              "args": ["--port", "5173"],
              "options": {
                "cwd": "\${workspaceFolder}/frontend",
                "env": { "NODE_ENV": "development" }
              }
            }
          ]
        }
      `;

      const task = resolverTaskEfetiva(tasksJson, "/home/app", "dev");
      expect(task.rotulo).toBe("NPM RUN DEV");
      expect(task.command).toBe("vite");
      expect(task.args).toEqual(["--port", "5173"]);
      expect(task.cwd).toBe("/home/app/frontend");
      expect(task.env).toEqual({ NODE_ENV: "development" });
    });
  });

  describe("4. TaskProcessManager no Host", () => {
    let tmpDir: string;
    let manager: TaskProcessManager;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-task-test-"));
      manager = new TaskProcessManager();
    });

    afterEach(async () => {
      await manager.stopAll();
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignora
      }
    });

    it("deve iniciar, coletar logs e parar um processo em segundo plano", async () => {
      // Cria arquivo de tasks simulando um script simples que emite stdout
      const vscodeDir = path.join(tmpDir, ".vscode");
      fs.mkdirSync(vscodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(vscodeDir, "tasks.json"),
        JSON.stringify({
          version: "2.0.0",
          tasks: [
            {
              label: "RUN DEV",
              type: "shell",
              command: "node -e 'console.log(\"Servidor dev iniciado\"); setInterval(() => {}, 1000);'",
            },
          ],
        })
      );

      // Inicia task
      const startResult = await manager.executeTask({
        companyId: "empresa-1",
        projectId: "proj-teste-1",
        projectName: "Projeto Teste",
        rootDir: tmpDir,
        taskType: "dev",
        action: "start",
      });

      expect(startResult.success).toBe(true);
      expect(startResult.status).toBe("rodando");
      expect(startResult.pid).toBeDefined();

      // Aguarda um momento para que o processo emita stdout
      await new Promise((resolve) => setTimeout(resolve, 300));

      const logsResult = manager.getLogs("empresa-1", "proj-teste-1", "dev");
      expect(logsResult.status).toBe("rodando");
      expect(logsResult.logs.some((l) => l.includes("Servidor dev iniciado"))).toBe(true);

      // Para a task
      const stopResult = await manager.executeTask({
        companyId: "empresa-1",
        projectId: "proj-teste-1",
        rootDir: tmpDir,
        taskType: "dev",
        action: "stop",
      });

      expect(stopResult.success).toBe(true);
      expect(stopResult.status).toBe("parado");

      const status = manager.getProcessStatus("empresa-1", "proj-teste-1", "dev");
      expect(status.status).toBe("parado");
    });

    it("deve limitar o buffer circular a 200 linhas de logs", async () => {
      const vscodeDir = path.join(tmpDir, ".vscode");
      fs.mkdirSync(vscodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(vscodeDir, "tasks.json"),
        JSON.stringify({
          version: "2.0.0",
          tasks: [
            {
              label: "RUN BUILD",
              type: "shell",
              command: "node -e 'for(let i=1; i<=250; i++) console.log(\"linha \" + i);'",
            },
          ],
        })
      );

      await manager.executeTask({
        companyId: "empresa-1",
        projectId: "proj-build-limit",
        rootDir: tmpDir,
        taskType: "build",
        action: "start",
      });

      // Aguarda término da execução rápida
      await new Promise((resolve) => setTimeout(resolve, 500));

      const logs = manager.getLogs("empresa-1", "proj-build-limit", "build");
      expect(logs.logs.length).toBeLessThanOrEqual(200);
      expect(logs.logs[logs.logs.length - 1]).toContain("Processo finalizado");
    });

    it("deve alternar entre start e stop ao usar toggle", async () => {
      const vscodeDir = path.join(tmpDir, ".vscode");
      fs.mkdirSync(vscodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(vscodeDir, "tasks.json"),
        JSON.stringify({
          version: "2.0.0",
          tasks: [
            {
              label: "RUN DEV",
              type: "shell",
              command: "node -e 'setInterval(() => {}, 1000);'",
            },
          ],
        })
      );

      // Primeiro toggle: inicia
      const toggle1 = await manager.executeTask({
        companyId: "empresa-1",
        projectId: "proj-toggle",
        rootDir: tmpDir,
        taskType: "dev",
        action: "toggle",
      });
      expect(toggle1.status).toBe("rodando");

      // Segundo toggle: encerra
      const toggle2 = await manager.executeTask({
        companyId: "empresa-1",
        projectId: "proj-toggle",
        rootDir: tmpDir,
        taskType: "dev",
        action: "toggle",
      });
      expect(toggle2.status).toBe("parado");
    });

    it("deve isolar processos e status por empresa mesmo com o mesmo projectId", async () => {
      const vscodeDir = path.join(tmpDir, ".vscode");
      fs.mkdirSync(vscodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(vscodeDir, "tasks.json"),
        JSON.stringify({
          version: "2.0.0",
          tasks: [{
            label: "RUN DEV",
            type: "shell",
            command: "node -e 'setInterval(() => {}, 1000);'",
          }],
        }),
      );

      await manager.executeTask({
        companyId: "empresa-a",
        projectId: "projeto-compartilhado",
        rootDir: tmpDir,
        taskType: "dev",
        action: "start",
      });

      expect(manager.getProcessStatus("empresa-a", "projeto-compartilhado", "dev").status).toBe("rodando");
      expect(manager.getProcessStatus("empresa-b", "projeto-compartilhado", "dev").status).toBe("parado");
      expect(manager.getAllStatuses("empresa-b")).toEqual({});
    });

    it("deve bloquear cwd e tasks.json que escapem da raiz autorizada", async () => {
      const vscodeDir = path.join(tmpDir, ".vscode");
      fs.mkdirSync(vscodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(vscodeDir, "tasks.json"),
        JSON.stringify({
          version: "2.0.0",
          tasks: [{
            label: "RUN BUILD",
            type: "shell",
            command: "node -e 'process.exit(0)'",
            options: { cwd: os.tmpdir() },
          }],
        }),
      );

      const result = await manager.executeTask({
        companyId: "empresa-1",
        projectId: "proj-traversal",
        rootDir: tmpDir,
        taskType: "build",
        action: "start",
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("erro");
      expect(result.message).toContain("fora da raiz autorizada");
    });

    it("deve ocultar segredos e truncar linhas excessivas nos logs", async () => {
      const vscodeDir = path.join(tmpDir, ".vscode");
      fs.mkdirSync(vscodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(vscodeDir, "tasks.json"),
        JSON.stringify({
          version: "2.0.0",
          tasks: [{
            label: "RUN BUILD",
            type: "process",
            command: process.execPath,
            args: ["-e", "console.log('API_TOKEN=super-secreto Bearer abc.def ' + 'x'.repeat(20000))"],
          }],
        }),
      );

      await manager.executeTask({
        companyId: "empresa-1",
        projectId: "proj-logs-seguros",
        rootDir: tmpDir,
        taskType: "build",
        action: "start",
      });
      await new Promise((resolve) => setTimeout(resolve, 300));

      const texto = manager.getLogs("empresa-1", "proj-logs-seguros", "build").logs.join("\n");
      expect(texto).not.toContain("super-secreto");
      expect(texto).not.toContain("abc.def");
      expect(texto).toContain("[REDACTED]");
      expect(texto).toContain("[linha truncada]");
      expect(Buffer.byteLength(texto, "utf-8")).toBeLessThanOrEqual(256 * 1024);
    });

    it("deve reconstruir linhas antes de ocultar segredos divididos entre chunks", async () => {
      const vscodeDir = path.join(tmpDir, ".vscode");
      fs.mkdirSync(vscodeDir, { recursive: true });
      fs.writeFileSync(path.join(vscodeDir, "tasks.json"), JSON.stringify({
        version: "2.0.0",
        tasks: [{
          label: "RUN BUILD",
          type: "process",
          command: process.execPath,
          args: ["-e", "process.stdout.write('API_TO'); setTimeout(() => process.stdout.write('KEN=segredo-fragmentado\\n'), 30)"],
        }],
      }));

      await manager.executeTask({
        companyId: "empresa-1",
        projectId: "proj-chunks",
        rootDir: tmpDir,
        taskType: "build",
        action: "start",
      });
      await new Promise((resolve) => setTimeout(resolve, 200));

      const texto = manager.getLogs("empresa-1", "proj-chunks", "build").logs.join("\n");
      expect(texto).not.toContain("segredo-fragmentado");
      expect(texto).toContain("API_TOKEN=[REDACTED]");
    });

    it("deve preservar a última linha sem quebra e caracteres UTF-8 divididos", async () => {
      const vscodeDir = path.join(tmpDir, ".vscode");
      fs.mkdirSync(vscodeDir, { recursive: true });
      fs.writeFileSync(path.join(vscodeDir, "tasks.json"), JSON.stringify({
        version: "2.0.0",
        tasks: [{
          label: "RUN BUILD",
          type: "process",
          command: process.execPath,
          args: ["-e", "const b=Buffer.from('final 🚀'); process.stdout.write(b.subarray(0,b.length-2)); setTimeout(()=>process.stdout.write(b.subarray(b.length-2)),30)"],
        }],
      }));

      await manager.executeTask({
        companyId: "empresa-1",
        projectId: "proj-utf8",
        rootDir: tmpDir,
        taskType: "build",
        action: "start",
      });
      await new Promise((resolve) => setTimeout(resolve, 200));

      const texto = manager.getLogs("empresa-1", "proj-utf8", "build").logs.join("\n");
      expect(texto).toContain("final 🚀");
      expect(texto).not.toContain("�");
    });

    it("deve excluir segredos do worker do ambiente herdado pela task", () => {
      const previous = process.env.PLUGIN_SECRET_TEST;
      process.env.PLUGIN_SECRET_TEST = "nao-herdar";
      try {
        const environment = criarAmbienteTask({ NODE_ENV: "test" });
        expect(environment.PLUGIN_SECRET_TEST).toBeUndefined();
        expect(environment.NODE_ENV).toBe("test");
        expect(environment.PATH ?? environment.Path).toBeTruthy();
        expect(environment.HOME ?? environment.USERPROFILE).toBeTruthy();
      } finally {
        if (previous === undefined) delete process.env.PLUGIN_SECRET_TEST;
        else process.env.PLUGIN_SECRET_TEST = previous;
      }
    });

    it("deve preservar argumentos shell com espaços e metacaracteres como um único valor", () => {
      const command = montarComandoShell("printf", ["%s", "valor com espaço;seguro"]);
      expect(command).toContain("valor com espaço;seguro");
      if (process.platform !== "win32") expect(command).toContain("'valor com espaço;seguro'");
    });

    it.skipIf(process.platform === "win32")(
      "deve manter e encerrar o grupo quando o processo principal deixa descendente resistente",
      async () => {
        const vscodeDir = path.join(tmpDir, ".vscode");
        fs.mkdirSync(vscodeDir, { recursive: true });
        fs.writeFileSync(path.join(vscodeDir, "tasks.json"), JSON.stringify({
          version: "2.0.0",
          tasks: [{
            label: "RUN DEV",
            type: "process",
            command: "/bin/sh",
            args: ["-c", "/bin/sh -c \"trap '' TERM; while :; do sleep 1; done\" &"],
          }],
        }));

        const started = await manager.executeTask({
          companyId: "empresa-1",
          projectId: "proj-descendente",
          rootDir: tmpDir,
          taskType: "dev",
          action: "start",
        });
        const groupPid = started.pid!;
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(manager.getProcessStatus("empresa-1", "proj-descendente", "dev").status).toBe("rodando");

        await manager.executeTask({
          companyId: "empresa-1",
          projectId: "proj-descendente",
          taskType: "dev",
          action: "stop",
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(() => process.kill(-groupPid, 0)).toThrow();
      },
      5000,
    );

    it.skipIf(process.platform === "win32")(
      "deve reconciliar o status quando o último descendente termina naturalmente",
      async () => {
        const vscodeDir = path.join(tmpDir, ".vscode");
        fs.mkdirSync(vscodeDir, { recursive: true });
        fs.writeFileSync(path.join(vscodeDir, "tasks.json"), JSON.stringify({
          version: "2.0.0",
          tasks: [{
            label: "RUN DEV",
            type: "process",
            command: process.execPath,
            args: ["-e", "const {spawn}=require('node:child_process'); const c=spawn('/bin/sh',['-c','sleep 0.3'],{stdio:'ignore'}); c.unref(); process.exit(0)"],
          }],
        }));

        await manager.executeTask({
          companyId: "empresa-1",
          projectId: "proj-reaper",
          rootDir: tmpDir,
          taskType: "dev",
          action: "start",
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(manager.getProcessStatus("empresa-1", "proj-reaper", "dev").status).toBe("rodando");
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(manager.getProcessStatus("empresa-1", "proj-reaper", "dev").status).toBe("parado");
      },
      3000,
    );
  });

  describe("5. Integração com Store e API Bridge", () => {
    beforeEach(() => {
      sidebarStore.setRunDevStatus("proj-api-test", "parado");
      sidebarStore.setRunBuildStatus("proj-api-test", "parado");
    });

    it("deve chamar a ação task-manager:execute no bridge e retornar status", async () => {
      const originalFetch = globalThis.fetch;
      let requestedUrl = "";
      let requestedBody: any = null;

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        requestedUrl = url;
        requestedBody = JSON.parse((init?.body as string) || "{}");
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            success: true,
            status: "rodando",
            pid: 9999,
          }),
        } as unknown as Response;
      });

      try {
        const result = await executeProjectTask("empresa-1", "proj-api-test", "dev", "toggle");
        expect(result.success).toBe(true);
        expect(result.status).toBe("rodando");
        expect(requestedUrl).toBe("/api/plugins/max.paperclip-plugin/bridge/action");
        expect(requestedBody.companyId).toBe("empresa-1");
        expect(requestedBody.key).toBe("task-manager:execute");
        expect(requestedBody.params).toEqual({
          projectId: "proj-api-test",
          taskType: "dev",
          action: "toggle",
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("deve sincronizar todos os status no store com setAllTaskStatuses", () => {
      sidebarStore.setAllTaskStatuses({
        "proj-1:dev": { status: "rodando", pid: 123 },
        "proj-1:build": { status: "erro", exitCode: 1 },
        "proj-2:dev": { status: "parado" },
      });

      const snap = sidebarStore.getSnapshot();
      expect(snap.runDevStates["proj-1"]).toBe("rodando");
      expect(snap.runBuildStates["proj-1"]).toBe("erro");
      expect(snap.runDevStates["proj-2"]).toBe("parado");
    });

    it("deve buscar logs através da API bridge", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            projectId: "proj-1",
            taskType: "dev",
            status: "rodando",
            logs: ["[12:00:00] Servidor ouvindo na porta 3000"],
            pid: 1234,
          }),
        } as unknown as Response;
      });

      try {
        const logs = await fetchTaskLogs("empresa-1", "proj-1", "dev");
        expect(logs?.status).toBe("rodando");
        expect(logs?.logs).toHaveLength(1);
        expect(logs?.pid).toBe(1234);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("deve enviar companyId, rootDir e projectName em executeProjectTask e desempacotar resposta aninhada em data", async () => {
      const originalFetch = globalThis.fetch;
      let capturedBody: any = null;

      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse((init?.body as string) || "{}");
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            data: {
              success: true,
              status: "rodando",
              pid: 7777,
            },
          }),
        } as unknown as Response;
      });

      try {
        const result = await executeProjectTask("comp-123", "proj-abc", "dev", "start", {
          rootDir: "/home/usuario/app",
          projectName: "Meu App",
        });

        expect(result.success).toBe(true);
        expect(result.status).toBe("rodando");
        expect(result.pid).toBe(7777);
        expect(capturedBody.companyId).toBe("comp-123");
        expect(capturedBody.key).toBe("task-manager:execute");
        expect(capturedBody.params).toEqual({
          projectId: "proj-abc",
          taskType: "dev",
          action: "start",
          rootDir: "/home/usuario/app",
          projectName: "Meu App",
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("deve paginar a listagem de tarefas até a última página", async () => {
      const originalFetch = globalThis.fetch;
      const urls: string[] = [];
      const primeiraPagina = Array.from({ length: 250 }, (_, index) => ({
        id: `issue-${index}`,
        title: `Issue ${index}`,
      }));
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        urls.push(url);
        const issues = url.includes("offset=250")
          ? [{ id: "issue-250", title: "Issue 250" }]
          : primeiraPagina;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ issues }),
        } as unknown as Response;
      });

      try {
        const issues = await fetchCompanyTasks("empresa-1");
        expect(issues).toHaveLength(251);
        expect(urls).toEqual([
          "/api/companies/empresa-1/issues?limit=250&offset=0",
          "/api/companies/empresa-1/issues?limit=250&offset=250",
        ]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("deve buscar projetos uma única vez conforme o contrato do host", async () => {
      const originalFetch = globalThis.fetch;
      const urls: string[] = [];
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        urls.push(url);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => [{ id: "proj-1", name: "Projeto" }],
        } as unknown as Response;
      });
      try {
        await expect(fetchCompanyProjects("empresa-1")).resolves.toHaveLength(1);
        expect(urls).toEqual(["/api/companies/empresa-1/projects?includeArchived=true"]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("deve preservar a tarefa principal quando uma exclusão filha falhar", async () => {
      const originalFetch = globalThis.fetch;
      const urls: string[] = [];
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        urls.push(url);
        const ok = !url.endsWith("/filha-2");
        return {
          ok,
          status: ok ? 200 : 500,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => (ok ? {} : { error: "falha simulada" }),
        } as unknown as Response;
      });

      try {
        await expect(deleteIssueCascade("pai", ["filha-1", "filha-2", "filha-3"])).resolves.toBe(false);
        expect(urls).toEqual(["/api/issues/filha-1", "/api/issues/filha-2"]);
        expect(urls).not.toContain("/api/issues/pai");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("6. Extração de Diretório Raiz do Projeto (extrairRaizDoProjeto)", () => {
    it("deve extrair a raiz a partir de codebase.effectiveLocalFolder", () => {
      const proj = {
        codebase: { effectiveLocalFolder: "/home/johnattas/GitHub/MaxCode/" },
      };
      expect(extrairRaizDoProjeto(proj)).toBe("/home/johnattas/GitHub/MaxCode");
    });

    it("deve extrair a raiz a partir de codebase.localFolder", () => {
      const proj = {
        codebase: { localFolder: "/home/johnattas/GitHub/EngeApp" },
      };
      expect(extrairRaizDoProjeto(proj)).toBe("/home/johnattas/GitHub/EngeApp");
    });

    it("deve extrair a raiz a partir de primaryWorkspace.cwd", () => {
      const proj = {
        primaryWorkspace: { cwd: "/home/johnattas/GitHub/MaxPinia/" },
      };
      expect(extrairRaizDoProjeto(proj)).toBe("/home/johnattas/GitHub/MaxPinia");
    });

    it("deve extrair a raiz a partir de workspaces[0].cwd", () => {
      const proj = {
        workspaces: [{ cwd: "/home/johnattas/GitHub/MaxAiManager" }],
      };
      expect(extrairRaizDoProjeto(proj)).toBe("/home/johnattas/GitHub/MaxAiManager");
    });

    it("deve retornar null se o projeto for inválido ou não tiver pastas locais", () => {
      expect(extrairRaizDoProjeto(null)).toBeNull();
      expect(extrairRaizDoProjeto({})).toBeNull();
      expect(extrairRaizDoProjeto({ codebase: {} })).toBeNull();
    });
  });
});
