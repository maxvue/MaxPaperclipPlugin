import type { SubagentExecution, ArtifactItem, ExecutionMetrics } from "./types.js";

export interface CommentLike {
  id?: string;
  body?: string | null;
  createdAt?: string | Date | null;
}

function toIsoString(date?: string | Date | null): string | undefined {
  if (!date) return undefined;
  return typeof date === "string" ? date : date.toISOString();
}

/**
 * Formata segundos em texto amigável (ex: '45s', '12m 30s', '1h 05m')
 */
export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "0s";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h === 0) return `${m}m ${s > 0 ? `${s}s` : ""}`.trim();
  return `${h}h ${remM > 0 ? `${remM}m` : ""}`.trim();
}

/**
 * Extrai identificadores de tarefas mencionadas no texto (ex.: ENG-42, #ENG-42, PAP-100)
 */
export function extractMentionedIssueIdentifiers(text: string, defaultPrefix?: string): string[] {
  if (!text) return [];

  // Captura identificadores no formato 2 a 10 letras maiúsculas seguidas de hífen e números
  const pattern = /(?:^|[\s#(,\[])([A-Z]{2,10}-\d+)(?:$|[\s#),.!?\]])/g;
  const matches = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match[1]) {
      matches.add(match[1]);
    }
  }

  // Também suporta menções por número isolado se tiver prefixo padrão (#42 ou issue 42)
  if (defaultPrefix) {
    const numPattern = /(?:^|[\s#(])#(\d+)(?:$|[\s#),.!?\]])/g;
    let nMatch: RegExpExecArray | null;
    while ((nMatch = numPattern.exec(text)) !== null) {
      if (nMatch[1]) {
        matches.add(`${defaultPrefix}-${nMatch[1]}`);
      }
    }
  }

  return Array.from(matches);
}

/**
 * Detecta invocações de subagentes dentro dos comentários da conversa
 * (Suporta padrões Antigravity, Codex, Paperclip subagent tools e JSON)
 */
export function parseSubagentInvocations(comments: CommentLike[]): SubagentExecution[] {
  const subagentsMap = new Map<string, SubagentExecution>();

  for (const comment of comments) {
    const body = comment.body || "";
    if (!body) continue;

    // 1. Padrão JSON de Tool Call invoke_subagent:
    // Captura "name", "Role", "role", "TypeName"
    const jsonMatches = body.matchAll(/\{[^{}]*"(?:name|Role|role|TypeName)"\s*:\s*"([^"]+)"[^{}]*\}/g);
    for (const jm of jsonMatches) {
      const jsonSnippet = jm[0];
      let name = "";
      let role = "";
      let typeName = "";

      const nameMatch = /"name"\s*:\s*"([^"]+)"/.exec(jsonSnippet);
      const roleMatch = /"(?:Role|role)"\s*:\s*"([^"]+)"/.exec(jsonSnippet);
      const typeMatch = /"TypeName"\s*:\s*"([^"]+)"/.exec(jsonSnippet);

      if (nameMatch) name = nameMatch[1];
      if (roleMatch) role = roleMatch[1];
      if (typeMatch) typeName = typeMatch[1];

      const finalName = name || role || typeName;
      if (finalName && !subagentsMap.has(finalName)) {
        subagentsMap.set(finalName, {
          id: `subagent-${subagentsMap.size + 1}`,
          name: finalName,
          role: role || name || `Subagente ${typeName || finalName}`,
          status: "done",
          runtimeMode: typeName || undefined,
          timestamp: toIsoString(comment.createdAt),
        });
      }
    }

    // 2. Padrão Antigravity / Codex: [Subagent: Security Auditor] ou Subagent: Security Auditor
    const subagentCallMatch = /\[?(?:Subagent|subagente|invoke_subagent)\]?[:\s]+([^,\n\r\]{}]+)/gi;
    let sm: RegExpExecArray | null;
    while ((sm = subagentCallMatch.exec(body)) !== null) {
      let rawName = sm[1].trim();
      // Limpa possíveis artefatos como aspas ou colchetes residuais
      rawName = rawName.replace(/^["'`]|["'`]$/g, "").trim();
      if (
        rawName &&
        !rawName.startsWith("{") &&
        !rawName.toLowerCase().includes("tool") &&
        rawName.length > 2 &&
        rawName.length < 50 &&
        !subagentsMap.has(rawName)
      ) {
        subagentsMap.set(rawName, {
          id: `subagent-${subagentsMap.size + 1}`,
          name: rawName,
          role: `Subagente ${rawName}`,
          status: "done",
          timestamp: toIsoString(comment.createdAt),
        });
      }
    }

    // 3. Padrão de tags de subagente estruturado: <subagent name="..." role="...">
    const tagMatch = /<subagent\s+name="([^"]+)"(?:\s+role="([^"]*)")?/gi;
    let tm: RegExpExecArray | null;
    while ((tm = tagMatch.exec(body)) !== null) {
      const name = tm[1];
      const role = tm[2] || name;
      if (!subagentsMap.has(name)) {
        subagentsMap.set(name, {
          id: `subagent-${subagentsMap.size + 1}`,
          name,
          role,
          status: "done",
          timestamp: toIsoString(comment.createdAt),
        });
      }
    }
  }

  return Array.from(subagentsMap.values());
}

/**
 * Consolida artefatos produzidos (documentos, anexos, arquivos gerados)
 */
export function parseArtifacts(
  comments: CommentLike[],
  issueDocuments: Array<{ id: string; key?: string; title?: string; createdAt?: string }> = [],
  attachments: Array<{ id: string; filename?: string; contentType?: string; byteSize?: number; createdAt?: string }> = [],
): ArtifactItem[] {
  const artifactsMap = new Map<string, ArtifactItem>();

  // 1. Documentos vinculados à issue (ex.: planDocument, spec, design)
  for (const doc of issueDocuments) {
    const key = doc.key || doc.id;
    artifactsMap.set(`doc:${doc.id}`, {
      id: doc.id,
      name: doc.title || (key === "plan" ? "Plano de Execução (plan)" : `Documento: ${key}`),
      type: key === "plan" ? "plan" : "document",
      createdAt: doc.createdAt,
    });
  }

  // 2. Anexos da issue
  for (const att of attachments) {
    artifactsMap.set(`att:${att.id}`, {
      id: att.id,
      name: att.filename || "Anexo sem nome",
      type: "attachment",
      size: att.byteSize,
      downloadUrl: `/api/attachments/${att.id}/download`,
      createdAt: att.createdAt,
    });
  }

  // 3. Artefatos detectados no corpo das mensagens (ex.: [ARTIFACT: name], links markdown, arquivos criados)
  for (const comment of comments) {
    const body = comment.body || "";
    if (!body) continue;

    // Padrão [ARTIFACT: name] Path: path
    const artifactMatch = /\[ARTIFACT:\s*([^\]]+)\](?:\s*Path:\s*([^\s\n]+))?/gi;
    let am: RegExpExecArray | null;
    while ((am = artifactMatch.exec(body)) !== null) {
      const name = am[1].trim();
      const path = am[2]?.trim();
      const key = `name:${name.toLowerCase()}`;
      if (!artifactsMap.has(key)) {
        artifactsMap.set(key, {
          id: `art-${artifactsMap.size + 1}`,
          name: name,
          type: "file",
          path: path,
          createdAt: toIsoString(comment.createdAt),
        });
      }
    }

    // Padrão de links markdown para arquivos: [filename.ext](file:///... ou path)
    const markdownLinkMatch = /\[([A-Za-z0-9_\-./]+\.[a-zA-Z0-9]+)\]\((?:file:\/\/|https?:\/\/|\/)?([^)]+)\)/g;
    let mm: RegExpExecArray | null;
    while ((mm = markdownLinkMatch.exec(body)) !== null) {
      const fileName = mm[1].trim();
      const filePath = mm[2].trim();
      const key = `name:${fileName.toLowerCase()}`;
      if (!artifactsMap.has(key) && !fileName.endsWith(".lock") && !fileName.endsWith(".log")) {
        artifactsMap.set(key, {
          id: `art-${artifactsMap.size + 1}`,
          name: fileName,
          type: fileName.includes("plan") ? "plan" : "file",
          path: filePath.startsWith("/") ? filePath : `/${filePath}`,
          createdAt: toIsoString(comment.createdAt),
        });
      }
    }

    // Padrão de arquivos criados: "TargetFile": "path" ou `TargetFile: /path` ou `write_to_file TargetFile: /path`
    const targetFileMatch = /(?:TargetFile|write_to_file|Created file|Arquivo criado)[\s:=]+`?([A-Za-z0-9_\-./]+\.[a-zA-Z0-9]+)`?/gi;
    let fm: RegExpExecArray | null;
    while ((fm = targetFileMatch.exec(body)) !== null) {
      const filePath = fm[1].trim();
      const fileName = filePath.split("/").pop() || filePath;
      const key = `name:${fileName.toLowerCase()}`;
      if (!artifactsMap.has(key) && !fileName.endsWith(".lock") && !fileName.endsWith(".log")) {
        artifactsMap.set(key, {
          id: `file-${artifactsMap.size + 1}`,
          name: fileName,
          type: "file",
          path: filePath,
          createdAt: toIsoString(comment.createdAt),
        });
      }
    }
  }

  return Array.from(artifactsMap.values());
}

/**
 * Calcula métricas de execução a partir dos comentários e tempo
 */
export function calculateExecutionMetrics(
  comments: CommentLike[],
  sessionOrStartedAt?: { createdAt?: string | Date } | string | null,
): ExecutionMetrics {
  let editsCount = 0;
  let toolsCount = 0;

  for (const comment of comments) {
    const body = comment.body || "";
    if (!body) continue;

    // Detecta edições de código/arquivos
    const replaceMatches = (body.match(/replace_file_content|edit_file|multi_replace_file_content/g) || []).length;
    const writeMatches = (body.match(/write_to_file/g) || []).length;
    const diffMatches = (body.match(/```diff[\s\S]*?```/g) || []).length;
    const commitMatches = (body.match(/git commit|committed|commit/gi) || []).length;
    editsCount += replaceMatches + writeMatches + diffMatches + (commitMatches > 0 ? 1 : 0);

    // Detecta chamadas de ferramentas gerais
    const toolCallMatches = (body.match(/run_command|grep_search|find_by_name|view_file|read_url_content/g) || []).length;
    toolsCount += toolCallMatches + replaceMatches + writeMatches;
  }

  // Identifica início da sessão / cronômetro
  let startedAtTime: number | null = null;
  if (typeof sessionOrStartedAt === "string") {
    startedAtTime = new Date(sessionOrStartedAt).getTime();
  } else if (sessionOrStartedAt && typeof sessionOrStartedAt === "object" && sessionOrStartedAt.createdAt) {
    startedAtTime = new Date(sessionOrStartedAt.createdAt).getTime();
  }

  // Duração
  let durationSeconds = 0;
  if (comments.length > 0) {
    const firstTime = startedAtTime || new Date(comments[0].createdAt || Date.now()).getTime();
    const lastTime = new Date(comments[comments.length - 1].createdAt || Date.now()).getTime();
    if (lastTime > firstTime) {
      durationSeconds = Math.max(1, Math.round((lastTime - firstTime) / 1000));
    }
  }

  const subagents = parseSubagentInvocations(comments);
  const artifacts = parseArtifacts(comments);

  return {
    totalSubagents: subagents.length,
    totalArtifacts: artifacts.length,
    totalEdits: editsCount,
    toolsCount: toolsCount,
    durationSeconds,
    formattedDuration: formatDuration(durationSeconds),
  };
}
