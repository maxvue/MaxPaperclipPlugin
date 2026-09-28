/**
 * Gerenciador de processos no backend worker do MaxPaperclipPlugin.
 * Responsável por controlar o ciclo de vida (start/stop/toggle), buffers de log e estados
 * de execução de tasks (.vscode/tasks.json) de projetos locais no host.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  resolverTaskEfetiva,
  type TipoDeTask,
  type StatusDeTask,
} from "./tasksJson.js";

const MAX_LOG_LINES = 200;

export interface ProcessRecord {
  projectId: string;
  projectName?: string;
  taskType: TipoDeTask;
  status: StatusDeTask;
  pid?: number;
  child?: ChildProcess;
  startedAt?: string;
  stoppedAt?: string;
  exitCode?: number | null;
  userStopped?: boolean;
  logs: string[];
}

export interface ExecuteTaskParams {
  projectId: string;
  projectName?: string;
  rootDir: string;
  taskType: TipoDeTask;
  action?: "start" | "stop" | "toggle";
}

export interface ExecuteTaskResult {
  success: boolean;
  status: StatusDeTask;
  pid?: number;
  message?: string;
}

export class TaskProcessManager {
  private processes = new Map<string, ProcessRecord>();

  private static key(projectId: string, taskType: TipoDeTask): string {
    return `${projectId}:${taskType}`;
  }

  private formatTimestamp(): string {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  private appendLog(record: ProcessRecord, line: string): void {
    const formatted = `[${this.formatTimestamp()}] ${line}`;
    record.logs.push(formatted);
    if (record.logs.length > MAX_LOG_LINES) {
      record.logs.shift();
    }
  }

  private appendChunk(record: ProcessRecord, chunk: string | Buffer): void {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Ignora última linha vazia resultante de quebra no final do chunk
      if (i === lines.length - 1 && line.trim() === "") continue;
      this.appendLog(record, line);
    }
  }

  getProcessRecord(projectId: string, taskType: TipoDeTask): ProcessRecord | undefined {
    return this.processes.get(TaskProcessManager.key(projectId, taskType));
  }

  getProcessStatus(
    projectId: string,
    taskType: TipoDeTask
  ): { status: StatusDeTask; pid?: number; startedAt?: string; exitCode?: number | null } {
    const rec = this.getProcessRecord(projectId, taskType);
    if (!rec) {
      return { status: "parado", exitCode: null };
    }
    return {
      status: rec.status,
      pid: rec.pid,
      startedAt: rec.startedAt,
      exitCode: rec.exitCode,
    };
  }

  getAllStatuses(): Record<
    string,
    { status: StatusDeTask; pid?: number; startedAt?: string; exitCode?: number | null }
  > {
    const result: Record<
      string,
      { status: StatusDeTask; pid?: number; startedAt?: string; exitCode?: number | null }
    > = {};
    for (const [k, rec] of this.processes.entries()) {
      result[k] = {
        status: rec.status,
        pid: rec.pid,
        startedAt: rec.startedAt,
        exitCode: rec.exitCode,
      };
    }
    return result;
  }

  getLogs(
    projectId: string,
    taskType: TipoDeTask
  ): {
    projectId: string;
    taskType: TipoDeTask;
    status: StatusDeTask;
    logs: string[];
    pid?: number;
    startedAt?: string;
  } {
    const rec = this.getProcessRecord(projectId, taskType);
    if (!rec) {
      return {
        projectId,
        taskType,
        status: "parado",
        logs: [],
      };
    }
    return {
      projectId,
      taskType,
      status: rec.status,
      logs: [...rec.logs],
      pid: rec.pid,
      startedAt: rec.startedAt,
    };
  }

  clearLogs(projectId: string, taskType: TipoDeTask): void {
    const rec = this.getProcessRecord(projectId, taskType);
    if (rec) {
      rec.logs = [];
    }
  }

  async stopTask(projectId: string, taskType: TipoDeTask): Promise<boolean> {
    const rec = this.getProcessRecord(projectId, taskType);
    if (!rec || !rec.child || rec.status !== "rodando") {
      if (rec) {
        rec.status = "parado";
      }
      return false;
    }

    rec.userStopped = true;
    this.appendLog(rec, `[MaxPaperclipPlugin] Solicitando parada do processo (PID ${rec.pid})...`);

    const child = rec.child;
    try {
      if (child.pid) {
        // Envia SIGTERM para o grupo do processo ou processo
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
      }
    } catch {
      // Ignora erro se já morreu
    }

    // Aguarda até 2s para encerramento gracioso antes de SIGKILL
    await new Promise<void>((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved && rec.status === "rodando" && child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            try {
              child.kill("SIGKILL");
            } catch {
              // ignora
            }
          }
        }
        resolved = true;
        resolve();
      }, 2000);

      child.once("exit", () => {
        if (!resolved) {
          clearTimeout(timer);
          resolved = true;
          resolve();
        }
      });
    });

    rec.status = "parado";
    rec.stoppedAt = new Date().toISOString();
    return true;
  }

  async startTask(
    projectId: string,
    rootDir: string,
    taskType: TipoDeTask,
    projectName?: string
  ): Promise<ExecuteTaskResult> {
    // Para processo existente se já estiver rodando
    await this.stopTask(projectId, taskType);

    if (!fs.existsSync(rootDir)) {
      return {
        success: false,
        status: "erro",
        message: `Diretório do projeto não encontrado: ${rootDir}`,
      };
    }

    // Leitura do .vscode/tasks.json se disponível
    let tasksJsonContent: string | null = null;
    const tasksJsonPath = path.join(rootDir, ".vscode", "tasks.json");
    if (fs.existsSync(tasksJsonPath)) {
      try {
        tasksJsonContent = fs.readFileSync(tasksJsonPath, "utf-8");
      } catch (err) {
        // Ignora erro de leitura
      }
    }

    const taskEfetiva = resolverTaskEfetiva(tasksJsonContent, rootDir, taskType);
    const key = TaskProcessManager.key(projectId, taskType);

    let rec = this.processes.get(key);
    if (!rec) {
      rec = {
        projectId,
        projectName,
        taskType,
        status: "parado",
        logs: [],
      };
      this.processes.set(key, rec);
    }

    rec.userStopped = false;
    rec.exitCode = null;
    rec.startedAt = new Date().toISOString();
    rec.stoppedAt = undefined;

    this.appendLog(
      rec,
      `[MaxPaperclipPlugin] Iniciando task "${taskEfetiva.rotulo}" (tipo: ${taskEfetiva.tipo}) em ${taskEfetiva.cwd}`
    );
    this.appendLog(
      rec,
      `[MaxPaperclipPlugin] Comando: ${taskEfetiva.command}${
        taskEfetiva.args && taskEfetiva.args.length > 0 ? " " + taskEfetiva.args.join(" ") : ""
      }`
    );

    let child: ChildProcess;
    try {
      const env = { ...process.env, ...(taskEfetiva.env ?? {}) };

      if (taskEfetiva.tipo === "process") {
        child = spawn(taskEfetiva.command, taskEfetiva.args ?? [], {
          cwd: taskEfetiva.cwd,
          env,
          shell: false,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } else {
        if (taskEfetiva.shellExecutable) {
          const shellArgs = taskEfetiva.shellArgs ?? ["-c"];
          const fullCmd = [taskEfetiva.command, ...(taskEfetiva.args ?? [])].join(" ");
          child = spawn(taskEfetiva.shellExecutable, [...shellArgs, fullCmd], {
            cwd: taskEfetiva.cwd,
            env,
            shell: false,
            detached: true,
            stdio: ["ignore", "pipe", "pipe"],
          });
        } else {
          const fullCmd = [taskEfetiva.command, ...(taskEfetiva.args ?? [])].join(" ");
          child = spawn(fullCmd, {
            cwd: taskEfetiva.cwd,
            env,
            shell: true,
            detached: true,
            stdio: ["ignore", "pipe", "pipe"],
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      rec.status = "erro";
      this.appendLog(rec, `[MaxPaperclipPlugin] Erro ao disparar processo: ${msg}`);
      return {
        success: false,
        status: "erro",
        message: msg,
      };
    }

    rec.child = child;
    rec.pid = child.pid;
    rec.status = "rodando";

    this.appendLog(rec, `[MaxPaperclipPlugin] Processo iniciado com PID ${child.pid}`);

    child.stdout?.on("data", (data) => {
      this.appendChunk(rec!, data);
    });

    child.stderr?.on("data", (data) => {
      this.appendChunk(rec!, data);
    });

    child.on("error", (err) => {
      rec!.status = "erro";
      this.appendLog(rec!, `[MaxPaperclipPlugin] Erro no processo: ${err.message}`);
    });

    child.on("exit", (code, signal) => {
      rec!.pid = undefined;
      rec!.exitCode = code;
      rec!.stoppedAt = new Date().toISOString();

      const finalStatus: StatusDeTask =
        rec!.userStopped || code === 0 || signal === "SIGTERM" ? "parado" : "erro";
      rec!.status = finalStatus;

      this.appendLog(
        rec!,
        `[MaxPaperclipPlugin] Processo finalizado com status ${finalStatus} (código: ${code}, sinal: ${signal})`
      );
    });

    return {
      success: true,
      status: "rodando",
      pid: child.pid,
    };
  }

  async executeTask(params: ExecuteTaskParams): Promise<ExecuteTaskResult> {
    const { projectId, rootDir, taskType, action = "toggle", projectName } = params;
    const currentStatus = this.getProcessStatus(projectId, taskType).status;

    if (action === "stop") {
      await this.stopTask(projectId, taskType);
      return { success: true, status: "parado" };
    }

    if (action === "start") {
      return await this.startTask(projectId, rootDir, taskType, projectName);
    }

    // Toggle
    if (currentStatus === "rodando") {
      await this.stopTask(projectId, taskType);
      return { success: true, status: "parado" };
    } else {
      return await this.startTask(projectId, rootDir, taskType, projectName);
    }
  }

  async stopAll(): Promise<void> {
    for (const [_, rec] of this.processes.entries()) {
      if (rec.status === "rodando" && rec.child) {
        try {
          if (rec.pid) {
            process.kill(-rec.pid, "SIGTERM");
          }
        } catch {
          try {
            rec.child.kill("SIGTERM");
          } catch {
            // ignora
          }
        }
        rec.status = "parado";
      }
    }
  }
}

// Instância singleton do gerenciador de processos no worker
export const taskProcessManager = new TaskProcessManager();
