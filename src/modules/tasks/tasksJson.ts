/**
 * Utilitários para parsing e resolução de tasks do .vscode/tasks.json
 * Baseado na arquitetura e padrão canônico do MaxCode.
 */

export type TipoDeTask = "dev" | "build";
export type StatusDeTask = "parado" | "rodando" | "erro";

export const TIPOS_DE_TASK: readonly TipoDeTask[] = ["dev", "build"];

/**
 * Rótulos aceitos por tipo no .vscode/tasks.json (idêntico ao MaxCode).
 */
export const ROTULOS_DE_TASK: Record<TipoDeTask, readonly string[]> = {
  dev: ["RUN DEV", "NPM RUN DEV", "DEV"],
  build: ["RUN BUILD", "NPM RUN BUILD", "BUILD"],
};

export const ROTULO_CANONICO: Record<TipoDeTask, string> = {
  dev: "RUN DEV",
  build: "RUN BUILD",
};

const CHAVES_DE_ROTULO = ["label", "taskName", "name"] as const;

export interface TaskDeclarada {
  rotulo: string;
  tipo: string;
  command?: string;
  args?: string[];
  script?: string;
  shellExecutable?: string;
  shellArgs?: string[];
  isBackground?: boolean;
  optionsCwd?: string;
  optionsEnv?: Record<string, string>;
}

export interface TaskEfetiva {
  rotulo: string;
  tipo: string;
  command: string;
  args?: string[];
  cwd: string;
  env?: Record<string, string>;
  shellExecutable?: string;
  shellArgs?: string[];
  isBackground?: boolean;
}

/**
 * Verifica se um rótulo corresponde ao tipo solicitado (sem distinção entre maiúsculas e minúsculas).
 */
export function rotuloEhDoTipo(rotulo: string, tipo: TipoDeTask): boolean {
  if (typeof rotulo !== "string") return false;
  return ROTULOS_DE_TASK[tipo].includes(rotulo.trim().toUpperCase());
}

/**
 * Remove comentários de linha única (//) e comentários em bloco de um JSONC,
 * preservando strings e removendo vírgulas trailing.
 */
export function despojarComentariosJsonc(conteudo: string): string {
  return conteudo
    .replace(/("(?:\\.|[^"\\])*")|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g, (_match, str) =>
      str !== undefined ? str : ""
    )
    .replace(/,\s*([}\]])/g, "$1");
}

function itensDeTasksJson(raiz: Record<string, unknown>): Record<string, unknown>[] {
  const itens: Record<string, unknown>[] = [];
  if (Array.isArray(raiz.tasks)) {
    for (const t of raiz.tasks) {
      if (t !== null && typeof t === "object") {
        itens.push(t as Record<string, unknown>);
      }
    }
  }
  itens.push(raiz);
  return itens;
}

function rotuloDoItem(item: Record<string, unknown>): string | undefined {
  for (const chave of CHAVES_DE_ROTULO) {
    const valor = item[chave];
    if (typeof valor === "string") {
      return valor;
    }
  }
  return undefined;
}

/**
 * Substitui variáveis do VS Code como ${workspaceFolder}, ${workspaceRoot}, ${cwd} e ${workspaceFolderBasename}.
 */
export function resolverVariaveisTask(texto: string, raiz: string, cwdEfetivo: string): string {
  const partes = raiz.replace(/[/\\]+$/, "").split(/[/\\]/);
  const nomePasta = partes[partes.length - 1] || "";

  return texto
    .replace(/\$\{(?:workspaceFolder|workspaceRoot)\}/g, cwdEfetivo)
    .replace(/\$\{workspaceFolderBasename\}/g, nomePasta)
    .replace(/\$\{cwd\}/g, cwdEfetivo);
}

/**
 * Lê a declaração da task do tipo pedido no conteúdo de um .vscode/tasks.json.
 */
export function lerTaskDeclaradaNoConteudo(
  conteudo: string,
  tipo: TipoDeTask
): TaskDeclarada | undefined {
  if (!conteudo || conteudo.trim() === "") return undefined;
  const limpo = despojarComentariosJsonc(conteudo);

  try {
    const parsed: unknown = JSON.parse(limpo);
    if (parsed === null || typeof parsed !== "object") return undefined;

    for (const item of itensDeTasksJson(parsed as Record<string, unknown>)) {
      const rotulo = rotuloDoItem(item);
      if (rotulo === undefined || !rotuloEhDoTipo(rotulo, tipo)) continue;

      const tipoJson =
        typeof item.type === "string" && item.type.trim() !== "" ? item.type : "shell";
      const args = Array.isArray(item.args)
        ? item.args.filter((arg): arg is string => typeof arg === "string")
        : undefined;
      const isBackground =
        typeof item.isBackground === "boolean" ? item.isBackground : undefined;

      const options = item.options as Record<string, unknown> | undefined;
      const optionsCwd =
        typeof options?.cwd === "string" && options.cwd.trim() !== ""
          ? options.cwd
          : undefined;

      let optionsEnv: Record<string, string> | undefined;
      if (options?.env && typeof options.env === "object") {
        const envEntries: [string, string][] = [];
        for (const [k, v] of Object.entries(options.env)) {
          if (typeof v === "string") {
            envEntries.push([k, v]);
          }
        }
        if (envEntries.length > 0) {
          optionsEnv = Object.fromEntries(envEntries);
        }
      }

      const shellOpts = options?.shell as Record<string, unknown> | undefined;
      const shellExecutable =
        typeof shellOpts?.executable === "string" && shellOpts.executable.trim() !== ""
          ? shellOpts.executable
          : undefined;
      const shellArgs = Array.isArray(shellOpts?.args)
        ? shellOpts.args.filter((arg): arg is string => typeof arg === "string")
        : undefined;

      return {
        rotulo,
        tipo: tipoJson,
        command: typeof item.command === "string" ? item.command : undefined,
        args,
        script: typeof item.script === "string" ? item.script : undefined,
        shellExecutable,
        shellArgs,
        isBackground,
        optionsCwd,
        optionsEnv,
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Retorna o fallback padrão caso o tasks.json não declare a tarefa.
 */
export function obterTaskFallback(raiz: string, tipo: TipoDeTask): TaskEfetiva {
  const comandoPadrao = tipo === "dev" ? "npm run dev" : "npm run build";
  const rotuloPadrao = tipo === "dev" ? "NPM RUN DEV" : "NPM RUN BUILD";

  return {
    rotulo: rotuloPadrao,
    tipo: "shell",
    command: comandoPadrao,
    cwd: raiz,
  };
}

/**
 * Resolve a task pronta para execução a partir do conteúdo do tasks.json e diretório raiz.
 * Aplica resolução de variáveis e fallback seguro.
 */
export function resolverTaskEfetiva(
  conteudoTasksJson: string | null | undefined,
  raiz: string,
  tipo: TipoDeTask
): TaskEfetiva {
  if (!conteudoTasksJson) {
    return obterTaskFallback(raiz, tipo);
  }

  const declarada = lerTaskDeclaradaNoConteudo(conteudoTasksJson, tipo);
  if (!declarada || !declarada.command) {
    return obterTaskFallback(raiz, tipo);
  }

  const cwdEfetivo = declarada.optionsCwd
    ? resolverVariaveisTask(declarada.optionsCwd, raiz, raiz)
    : raiz;

  const commandResolvido = resolverVariaveisTask(declarada.command, raiz, cwdEfetivo);
  const argsResolvidos = declarada.args?.map((arg) =>
    resolverVariaveisTask(arg, raiz, cwdEfetivo)
  );

  return {
    rotulo: declarada.rotulo,
    tipo: declarada.tipo,
    command: commandResolvido,
    args: argsResolvidos,
    cwd: cwdEfetivo,
    env: declarada.optionsEnv,
    shellExecutable: declarada.shellExecutable,
    shellArgs: declarada.shellArgs,
    isBackground: declarada.isBackground,
  };
}
