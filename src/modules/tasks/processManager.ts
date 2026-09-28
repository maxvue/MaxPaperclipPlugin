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
const MAX_LOG_BYTES = 256 * 1024;
const MAX_LOG_LINE_BYTES = 16 * 1024;

function caminhoEstaDentroDaRaiz(raiz: string, candidato: string): boolean {
  const relativo = path.relative(raiz, candidato);
  return relativo === "" || (!relativo.startsWith("..") && !path.isAbsolute(relativo));
}

function resolverDiretorioConfinado(raiz: string, candidato: string): string {
  const resolvido = fs.realpathSync(candidato);
  if (!caminhoEstaDentroDaRaiz(raiz, resolvido)) {
    throw new Error(`Diretório fora da raiz autorizada do projeto: ${candidato}`);
  }
  return resolvido;
}

function ocultarSegredos(texto: string): string {
  return texto
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, "$1[REDACTED]")
    .replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY))=([^\s]+)/gi, "$1=[REDACTED]");
}

export interface ProcessRecord {
  companyId: string;
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
  logBytes: number;
  generation: number;
}

export interface ExecuteTaskParams {
  companyId: string;
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
  private operations = new Map<string, Promise<ExecuteTaskResult>>();

  private static key(companyId: string, projectId: string, taskType: TipoDeTask): string {
    return `${companyId}:${projectId}:${taskType}`;
  }

  private formatTimestamp(): string {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  private appendLog(record: ProcessRecord, line: string): void {
    const seguro = ocultarSegredos(line);
    const buffer = Buffer.from(seguro, "utf-8");
    const limitado =
      buffer.byteLength > MAX_LOG_LINE_BYTES
        ? `${buffer.subarray(0, MAX_LOG_LINE_BYTES).toString("utf-8")}… [linha truncada]`
        : seguro;
    const formatted = `[${this.formatTimestamp()}] ${limitado}`;
    record.logs.push(formatted);
    record.logBytes += Buffer.byteLength(formatted, "utf-8");
    while (record.logs.length > MAX_LOG_LINES || record.logBytes > MAX_LOG_BYTES) {
      const removida = record.logs.shift();
      if (!removida) break;
      record.logBytes -= Buffer.byteLength(removida, "utf-8");
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

  getProcessRecord(companyId: string, projectId: string, taskType: TipoDeTask): ProcessRecord | undefined {
    return this.processes.get(TaskProcessManager.key(companyId, projectId, taskType));
  }

  getProcessStatus(
    companyId: string,
    projectId: string,
    taskType: TipoDeTask
  ): { status: StatusDeTask; pid?: number; startedAt?: string; exitCode?: number | null } {
    const rec = this.getProcessRecord(companyId, projectId, taskType);
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

  getAllStatuses(companyId: string): Record<
    string,
    { status: StatusDeTask; pid?: number; startedAt?: string; exitCode?: number | null }
  > {
    const result: Record<
      string,
      { status: StatusDeTask; pid?: number; startedAt?: string; exitCode?: number | null }
    > = {};
    for (const rec of this.processes.values()) {
      if (rec.companyId !== companyId) continue;
      result[`${rec.projectId}:${rec.taskType}`] = {
        status: rec.status,
        pid: rec.pid,
        startedAt: rec.startedAt,
        exitCode: rec.exitCode,
      };
    }
    return result;
  }

  getLogs(
    companyId: string,
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
    const rec = this.getProcessRecord(companyId, projectId, taskType);
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

  clearLogs(companyId: string, projectId: string, taskType: TipoDeTask): void {
    const rec = this.getProcessRecord(companyId, projectId, taskType);
    if (rec) {
      rec.logs = [];
      rec.logBytes = 0;
    }
  }

  async stopTask(companyId: string, projectId: string, taskType: TipoDeTask): Promise<boolean> {
    const rec = this.getProcessRecord(companyId, projectId, taskType);
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
    companyId: string,
    projectId: string,
    rootDir: string,
    taskType: TipoDeTask,
    projectName?: string
  ): Promise<ExecuteTaskResult> {
    // Para processo existente se já estiver rodando
    await this.stopTask(companyId, projectId, taskType);

    if (!path.isAbsolute(rootDir) || !fs.existsSync(rootDir)) {
      return {
        success: false,
        status: "erro",
        message: `Diretório do projeto não encontrado: ${rootDir}`,
      };
    }

    let raizReal: string;
    try {
      raizReal = fs.realpathSync(rootDir);
      if (!fs.statSync(raizReal).isDirectory()) throw new Error("a raiz não é um diretório");
    } catch (err) {
      return {
        success: false,
        status: "erro",
        message: `Raiz do projeto inválida: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Leitura do .vscode/tasks.json se disponível
    let tasksJsonContent: string | null = null;
    const tasksJsonPath = path.join(raizReal, ".vscode", "tasks.json");
    if (fs.existsSync(tasksJsonPath)) {
      try {
        const tasksJsonReal = fs.realpathSync(tasksJsonPath);
        if (!caminhoEstaDentroDaRaiz(raizReal, tasksJsonReal)) {
          throw new Error("tasks.json aponta para fora da raiz autorizada");
        }
        tasksJsonContent = fs.readFileSync(tasksJsonReal, "utf-8");
      } catch (err) {
        return {
          success: false,
          status: "erro",
          message: `Não foi possível ler tasks.json com segurança: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    const taskEfetiva = resolverTaskEfetiva(tasksJsonContent, raizReal, taskType);
    try {
      taskEfetiva.cwd = resolverDiretorioConfinado(raizReal, taskEfetiva.cwd);
    } catch (err) {
      return {
        success: false,
        status: "erro",
        message: err instanceof Error ? err.message : String(err),
      };
    }
    const key = TaskProcessManager.key(companyId, projectId, taskType);

    let rec = this.processes.get(key);
    if (!rec) {
      rec = {
        companyId,
        projectId,
        projectName,
        taskType,
        status: "parado",
        logs: [],
        logBytes: 0,
        generation: 0,
      };
      this.processes.set(key, rec);
    }

    rec.userStopped = false;
    rec.generation += 1;
    const generation = rec.generation;
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

    try {
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      rec.status = "erro";
      rec.child = undefined;
      this.appendLog(rec, `[MaxPaperclipPlugin] Erro ao iniciar processo: ${message}`);
      return { success: false, status: "erro", message };
    }

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
      if (rec!.generation !== generation) return;
      rec!.status = "erro";
      this.appendLog(rec!, `[MaxPaperclipPlugin] Erro no processo: ${err.message}`);
    });

    child.on("exit", (code, signal) => {
      if (rec!.generation !== generation) return;
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
    const key = TaskProcessManager.key(params.companyId, params.projectId, params.taskType);
    const anterior = this.operations.get(key) ?? Promise.resolve({ success: true, status: "parado" as const });
    const atual = anterior.catch(() => ({ success: false, status: "erro" as const })).then(() => this.executeTaskSerializada(params));
    this.operations.set(key, atual);
    try {
      return await atual;
    } finally {
      if (this.operations.get(key) === atual) this.operations.delete(key);
    }
  }

  private async executeTaskSerializada(params: ExecuteTaskParams): Promise<ExecuteTaskResult> {
    const { companyId, projectId, rootDir, taskType, action = "toggle", projectName } = params;
    const currentStatus = this.getProcessStatus(companyId, projectId, taskType).status;

    if (action === "stop") {
      await this.stopTask(companyId, projectId, taskType);
      return { success: true, status: "parado" };
    }

    if (action === "start") {
      return await this.startTask(companyId, projectId, rootDir, taskType, projectName);
    }

    // Toggle
    if (currentStatus === "rodando") {
      await this.stopTask(companyId, projectId, taskType);
      return { success: true, status: "parado" };
    } else {
      return await this.startTask(companyId, projectId, rootDir, taskType, projectName);
    }
  }

  async stopAll(): Promise<void> {
    const running = [...this.processes.values()].filter(
      (rec) => rec.status === "rodando" && rec.child,
    );
    await Promise.all(
      running.map((rec) => this.stopTask(rec.companyId, rec.projectId, rec.taskType)),
    );
  }
}

// Instância singleton do gerenciador de processos no worker
export const taskProcessManager = new TaskProcessManager();
