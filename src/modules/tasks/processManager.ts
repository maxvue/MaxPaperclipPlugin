/**
 * Gerenciador de processos no backend worker do MaxPaperclipPlugin.
 * Responsável por controlar o ciclo de vida (start/stop/toggle), buffers de log e estados
 * de execução de tasks (.vscode/tasks.json) de projetos locais no host.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
  resolverTaskEfetiva,
  type TipoDeTask,
  type StatusDeTask,
} from "./tasksJson.js";

const MAX_LOG_LINES = 200;
const MAX_LOG_BYTES = 256 * 1024;
const MAX_LOG_LINE_BYTES = 16 * 1024;
const SAFE_INHERITED_ENV_KEYS = new Set([
  "PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC",
  "TMP", "TEMP", "TMPDIR", "LANG", "LC_ALL", "TERM", "COLORTERM", "CI",
  "HOME", "USERPROFILE", "USER", "LOGNAME", "SHELL", "APPDATA", "LOCALAPPDATA",
  "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME",
]);

export function criarAmbienteTask(overrides?: Record<string, string>): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of SAFE_INHERITED_ENV_KEYS) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  return { ...environment, ...(overrides ?? {}) };
}

function quoteShellArgument(argument: string): string {
  if (process.platform === "win32") {
    if (/^[A-Za-z0-9_./:\\=-]+$/.test(argument)) return argument;
    return `"${argument.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/, "$1$1")}"`;
  }
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(argument)) return argument;
  return `'${argument.replace(/'/g, `'"'"'`)}'`;
}

export function montarComandoShell(command: string, args: string[] = []): string {
  const executable = /[\\/]/.test(command) && /\s/.test(command)
    ? quoteShellArgument(command)
    : command;
  return [executable, ...args.map(quoteShellArgument)].join(" ");
}

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
  processGroupPid?: number;
  child?: ChildProcess;
  startedAt?: string;
  stoppedAt?: string;
  exitCode?: number | null;
  userStopped?: boolean;
  logs: string[];
  logBytes: number;
  generation: number;
  stdoutRemainder: string;
  stderrRemainder: string;
  stdoutDecoder: StringDecoder;
  stderrDecoder: StringDecoder;
}

export interface ExecuteTaskParams {
  companyId: string;
  projectId: string;
  projectName?: string;
  rootDir?: string;
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
  private shuttingDown = false;

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

  private getOrCreateRecord(
    companyId: string,
    projectId: string,
    taskType: TipoDeTask,
    projectName?: string
  ): ProcessRecord {
    const key = TaskProcessManager.key(companyId, projectId, taskType);
    const existente = this.processes.get(key);
    if (existente) {
      if (projectName) existente.projectName = projectName;
      return existente;
    }

    const record: ProcessRecord = {
      companyId,
      projectId,
      projectName,
      taskType,
      status: "parado",
      logs: [],
      logBytes: 0,
      generation: 0,
      stdoutRemainder: "",
      stderrRemainder: "",
      stdoutDecoder: new StringDecoder("utf8"),
      stderrDecoder: new StringDecoder("utf8"),
    };
    this.processes.set(key, record);
    return record;
  }

  registrarFalhaDeExecucao(
    companyId: string,
    projectId: string,
    taskType: TipoDeTask,
    message: string,
    projectName?: string
  ): ExecuteTaskResult {
    const record = this.getOrCreateRecord(companyId, projectId, taskType, projectName);
    record.generation += 1;
    record.status = "erro";
    record.pid = undefined;
    record.processGroupPid = undefined;
    record.child = undefined;
    record.exitCode = null;
    record.startedAt = undefined;
    record.stoppedAt = new Date().toISOString();
    record.stdoutRemainder = "";
    record.stderrRemainder = "";
    record.stdoutDecoder = new StringDecoder("utf8");
    record.stderrDecoder = new StringDecoder("utf8");
    this.appendLog(record, `[MaxPaperclipPlugin] Falha ao executar task: ${message}`);
    return { success: false, status: "erro", message };
  }

  private appendChunk(record: ProcessRecord, chunk: string | Buffer, stream: "stdout" | "stderr"): void {
    const remainderKey = stream === "stdout" ? "stdoutRemainder" : "stderrRemainder";
    const decoder = stream === "stdout" ? record.stdoutDecoder : record.stderrDecoder;
    const decoded = typeof chunk === "string" ? chunk : decoder.write(chunk);
    const text = record[remainderKey] + decoded;
    const lines = text.split(/\r?\n/);
    record[remainderKey] = lines.pop() ?? "";
    for (const line of lines) this.appendLog(record, line);

    // Evita crescimento ilimitado quando o processo nunca emite uma quebra de linha.
    if (Buffer.byteLength(record[remainderKey], "utf-8") > MAX_LOG_BYTES) {
      this.appendLog(record, record[remainderKey]);
      record[remainderKey] = "";
    }
  }

  private flushRemainders(record: ProcessRecord): void {
    record.stdoutRemainder += record.stdoutDecoder.end();
    record.stderrRemainder += record.stderrDecoder.end();
    if (record.stdoutRemainder) this.appendLog(record, record.stdoutRemainder);
    if (record.stderrRemainder) this.appendLog(record, record.stderrRemainder);
    record.stdoutRemainder = "";
    record.stderrRemainder = "";
  }

  private watchProcessGroupExit(record: ProcessRecord, generation: number, processGroupPid: number): void {
    const reaper = setInterval(() => {
      if (
        record.generation !== generation ||
        record.userStopped ||
        record.processGroupPid !== processGroupPid
      ) {
        clearInterval(reaper);
        return;
      }
      if (this.processGroupIsAlive(processGroupPid)) return;
      clearInterval(reaper);
      record.status = "parado";
      record.pid = undefined;
      record.processGroupPid = undefined;
      record.stoppedAt = new Date().toISOString();
      this.appendLog(record, "[MaxPaperclipPlugin] Todos os processos descendentes foram finalizados.");
    }, 250);
    reaper.unref?.();
  }

  private processGroupIsAlive(pid: number): boolean {
    if (process.platform === "win32") return false;
    try {
      process.kill(-pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private async terminateWindowsTree(pid: number): Promise<void> {
    if (process.platform !== "win32") return;
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.once("error", () => resolve());
      killer.once("close", () => resolve());
    });
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
    const child = rec?.child;
    const processGroupPid = rec?.processGroupPid ?? child?.pid;
    if (!rec || rec.status !== "rodando" || (!child && !processGroupPid)) {
      if (rec) {
        rec.status = "parado";
      }
      return false;
    }

    rec.userStopped = true;
    this.appendLog(rec, `[MaxPaperclipPlugin] Solicitando parada do processo (PID ${rec.pid})...`);

    try {
      if (processGroupPid) {
        if (process.platform === "win32") {
          await this.terminateWindowsTree(processGroupPid);
        } else {
          // Envia SIGTERM para o grupo do processo ou processo
          try {
            process.kill(-processGroupPid, "SIGTERM");
          } catch {
            child?.kill("SIGTERM");
          }
        }
      }
    } catch {
      // Ignora erro se já morreu
    }

    // Aguarda até 2s para encerramento gracioso antes de SIGKILL
    await new Promise<void>((resolve) => {
      let resolved = false;
      const poll = setInterval(() => {
        if (process.platform !== "win32" && processGroupPid && !this.processGroupIsAlive(processGroupPid)) {
          finish();
        }
      }, 50);
      const finish = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        clearInterval(poll);
        resolve();
      };
      const timer = setTimeout(() => {
        if (
          !resolved &&
          processGroupPid &&
          (process.platform === "win32" || this.processGroupIsAlive(processGroupPid))
        ) {
          try {
            process.kill(-processGroupPid, "SIGKILL");
          } catch {
            try {
              child?.kill("SIGKILL");
            } catch {
              // ignora
            }
          }
        }
        finish();
      }, 2000);

      child?.once("exit", () => {
        if (process.platform === "win32" || !processGroupPid || !this.processGroupIsAlive(processGroupPid)) finish();
      });
    });

    this.flushRemainders(rec);
    rec.status = "parado";
    rec.pid = undefined;
    rec.processGroupPid = undefined;
    rec.child = undefined;
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

    const rec = this.getOrCreateRecord(companyId, projectId, taskType, projectName);

    if (!path.isAbsolute(rootDir) || !fs.existsSync(rootDir)) {
      return this.registrarFalhaDeExecucao(
        companyId,
        projectId,
        taskType,
        `Diretório do projeto não encontrado: ${rootDir}`,
        projectName
      );
    }

    let raizReal: string;
    try {
      raizReal = fs.realpathSync(rootDir);
      if (!fs.statSync(raizReal).isDirectory()) throw new Error("a raiz não é um diretório");
    } catch (err) {
      return this.registrarFalhaDeExecucao(
        companyId,
        projectId,
        taskType,
        `Raiz do projeto inválida: ${err instanceof Error ? err.message : String(err)}`,
        projectName
      );
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
        return this.registrarFalhaDeExecucao(
          companyId,
          projectId,
          taskType,
          `Não foi possível ler tasks.json com segurança: ${err instanceof Error ? err.message : String(err)}`,
          projectName
        );
      }
    }

    const taskEfetiva = resolverTaskEfetiva(tasksJsonContent, raizReal, taskType);
    try {
      taskEfetiva.cwd = resolverDiretorioConfinado(raizReal, taskEfetiva.cwd);
    } catch (err) {
      return this.registrarFalhaDeExecucao(
        companyId,
        projectId,
        taskType,
        err instanceof Error ? err.message : String(err),
        projectName
      );
    }

    rec.userStopped = false;
    rec.stdoutRemainder = "";
    rec.stderrRemainder = "";
    rec.stdoutDecoder = new StringDecoder("utf8");
    rec.stderrDecoder = new StringDecoder("utf8");
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
      `[MaxPaperclipPlugin] Comando configurado (${taskEfetiva.args?.length ?? 0} argumento(s)); conteúdo omitido dos logs.`
    );

    let child: ChildProcess;
    try {
      const env = criarAmbienteTask(taskEfetiva.env);

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
          const fullCmd = montarComandoShell(taskEfetiva.command, taskEfetiva.args);
          child = spawn(taskEfetiva.shellExecutable, [...shellArgs, fullCmd], {
            cwd: taskEfetiva.cwd,
            env,
            shell: false,
            detached: true,
            stdio: ["ignore", "pipe", "pipe"],
          });
        } else {
          const fullCmd = montarComandoShell(taskEfetiva.command, taskEfetiva.args);
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
    rec.processGroupPid = child.pid;
    rec.status = "rodando";
    this.appendLog(rec, `[MaxPaperclipPlugin] Processo iniciado com PID ${child.pid}`);

    child.stdout?.on("data", (data) => {
      this.appendChunk(rec!, data, "stdout");
    });

    child.stderr?.on("data", (data) => {
      this.appendChunk(rec!, data, "stderr");
    });

    child.on("error", (err) => {
      if (rec!.generation !== generation) return;
      this.flushRemainders(rec!);
      rec!.status = "erro";
      this.appendLog(rec!, `[MaxPaperclipPlugin] Erro no processo: ${err.message}`);
    });

    child.on("exit", (code, signal) => {
      if (rec!.generation !== generation) return;
      this.flushRemainders(rec!);
      rec!.child = undefined;
      rec!.exitCode = code;
      rec!.stoppedAt = new Date().toISOString();

      if (
        !rec!.userStopped &&
        rec!.processGroupPid &&
        this.processGroupIsAlive(rec!.processGroupPid)
      ) {
        rec!.status = "rodando";
        this.appendLog(rec!, "[MaxPaperclipPlugin] Processo principal finalizado; aguardando processos descendentes.");
        this.watchProcessGroupExit(rec!, generation, rec!.processGroupPid);
        return;
      }

      rec!.pid = undefined;
      rec!.processGroupPid = undefined;

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
    if (this.shuttingDown) {
      return { success: false, status: "erro", message: "gerenciador de processos em encerramento" };
    }
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
      if (!rootDir) {
        return this.registrarFalhaDeExecucao(
          companyId,
          projectId,
          taskType,
          "raiz do projeto não informada",
          projectName
        );
      }
      return await this.startTask(companyId, projectId, rootDir, taskType, projectName);
    }

    // Toggle
    if (currentStatus === "rodando") {
      await this.stopTask(companyId, projectId, taskType);
      return { success: true, status: "parado" };
    } else {
      if (!rootDir) {
        return this.registrarFalhaDeExecucao(
          companyId,
          projectId,
          taskType,
          "raiz do projeto não informada",
          projectName
        );
      }
      return await this.startTask(companyId, projectId, rootDir, taskType, projectName);
    }
  }

  async stopAll(): Promise<void> {
    this.shuttingDown = true;
    await Promise.allSettled([...this.operations.values()]);
    const running = [...this.processes.values()].filter(
      (rec) => rec.child || rec.processGroupPid,
    );
    await Promise.all(
      running.map((rec) => this.stopTask(rec.companyId, rec.projectId, rec.taskType)),
    );
  }
}

// Instância singleton do gerenciador de processos no worker
export const taskProcessManager = new TaskProcessManager();
