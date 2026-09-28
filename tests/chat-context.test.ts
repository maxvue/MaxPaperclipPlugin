// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  extractMentionedIssueIdentifiers,
  parseSubagentInvocations,
  parseArtifacts,
  calculateExecutionMetrics,
} from "../src/modules/chat-context/parser.js";
import type { RawIssueComment } from "../src/modules/chat-sessions/store.js";
import type { ChatSession } from "../src/modules/chat-sessions/types.js";

describe("MaxPaperclipPlugin - Módulo de Contexto e Execução (Chat Context)", () => {
  describe("Extração de Identificadores de Tarefas Mencionadas", () => {
    it("deve extrair referências a tarefas em diferentes formatos no texto", () => {
      const text = `
        Olá! Conforme alinhado na tarefa ENG-42 e também no ticket ENG-105,
        precisamos revisar os requisitos. Veja também ABC-999 e ENG-42 novamente.
      `;
      const ids = extractMentionedIssueIdentifiers(text, "ENG");
      expect(ids).toContain("ENG-42");
      expect(ids).toContain("ENG-105");
      expect(ids).toContain("ABC-999");
      // Não deve ter duplicatas
      expect(ids.filter((id) => id === "ENG-42").length).toBe(1);
    });

    it("deve ignorar textos sem referências a tarefas", () => {
      const text = "Apenas uma conversa comum sem menções a tickets ou issues.";
      const ids = extractMentionedIssueIdentifiers(text, "ENG");
      expect(ids).toEqual([]);
    });

    it("deve lidar com inputs nulos ou vazios com segurança", () => {
      expect(extractMentionedIssueIdentifiers("", "ENG")).toEqual([]);
      expect(extractMentionedIssueIdentifiers(null as any, "ENG")).toEqual([]);
      expect(extractMentionedIssueIdentifiers(undefined as any, "ENG")).toEqual([]);
    });
  });

  describe("Parser de Subagentes Utilizados", () => {
    it("deve detectar invocações de subagentes a partir do corpo das mensagens", () => {
      const comments: RawIssueComment[] = [
        {
          id: "c1",
          body: `
            Chamando subagente especializado:
            invoke_subagent: { "name": "Codebase Researcher", "role": "Researcher", "prompt": "Pesquisar rotas" }
          `,
          createdAt: "2026-09-28T10:00:00Z",
        },
        {
          id: "c2",
          body: `
            Iniciando agente de revisão:
            [Subagent: Security Auditor] analisando as permissões.
          `,
          createdAt: "2026-09-28T10:05:00Z",
        },
      ];

      const subagents = parseSubagentInvocations(comments);
      expect(subagents.length).toBeGreaterThanOrEqual(1);
      const names = subagents.map((s) => s.name);
      expect(names.some((n) => n.includes("Codebase Researcher") || n.includes("Researcher"))).toBe(true);
    });

    it("deve retornar lista vazia caso não haja subagentes chamados", () => {
      const comments: RawIssueComment[] = [
        {
          id: "c1",
          body: "Olá, sou o assistente e estou pronto para ajudar.",
          createdAt: "2026-09-28T10:00:00Z",
        },
      ];
      const subagents = parseSubagentInvocations(comments);
      expect(subagents).toEqual([]);
    });
  });

  describe("Parser de Artefatos Produzidos", () => {
    it("deve identificar artefatos e arquivos gerados ou editados no chat", () => {
      const comments: RawIssueComment[] = [
        {
          id: "c1",
          body: `
            Criado o arquivo de plano:
            [implementation_plan.md](file:///path/to/implementation_plan.md)
            Também gerado [walkthrough.md](file:///path/to/walkthrough.md)
            Escrevendo arquivo: write_to_file TargetFile: /src/ui/Component.tsx
          `,
          createdAt: "2026-09-28T10:00:00Z",
        },
      ];

      const artifacts = parseArtifacts(comments);
      expect(artifacts.length).toBeGreaterThanOrEqual(2);
      const fileNames = artifacts.map((a) => a.name);
      expect(fileNames.some((f) => f.includes("implementation_plan.md"))).toBe(true);
      expect(fileNames.some((f) => f.includes("walkthrough.md"))).toBe(true);
    });

    it("deve deduplicar artefatos referenciados múltiplas vezes", () => {
      const comments: RawIssueComment[] = [
        {
          id: "c1",
          body: "Atualizando [implementation_plan.md](file:///path/implementation_plan.md)",
          createdAt: "2026-09-28T10:00:00Z",
        },
        {
          id: "c2",
          body: "Revisando [implementation_plan.md](file:///path/implementation_plan.md)",
          createdAt: "2026-09-28T10:05:00Z",
        },
      ];

      const artifacts = parseArtifacts(comments);
      const planArtifacts = artifacts.filter((a) => a.name.includes("implementation_plan.md"));
      expect(planArtifacts.length).toBe(1);
    });
  });

  describe("Cálculo de Métricas de Execução", () => {
    it("deve calcular métricas consolidadas a partir dos comentários e sessão", () => {
      const comments: RawIssueComment[] = [
        {
          id: "c1",
          body: `
            Iniciando tarefa.
            replace_file_content TargetFile: src/App.tsx
            write_to_file TargetFile: src/components/Card.tsx
            [plano.md](file:///plano.md)
            invoke_subagent: Test Runner
          `,
          createdAt: "2026-09-28T10:00:00Z",
        },
        {
          id: "c2",
          body: `
            Finalizado com sucesso.
            replace_file_content TargetFile: src/App.tsx
          `,
          createdAt: "2026-09-28T10:15:00Z",
        },
      ];

      const session: ChatSession = {
        id: "session-gen-0",
        agentRef: "ceo",
        companyId: "comp-1",
        issueId: "issue-1",
        generation: 0,
        title: "Sessão Teste",
        createdAt: "2026-09-28T10:00:00Z",
        updatedAt: "2026-09-28T10:15:00Z",
        messagesCount: 2,
        snippet: "Iniciando tarefa...",
      };

      const metrics = calculateExecutionMetrics(comments, session);
      expect(metrics.totalSubagents).toBeGreaterThanOrEqual(1);
      expect(metrics.totalArtifacts).toBeGreaterThanOrEqual(1);
      expect(metrics.totalEdits).toBeGreaterThanOrEqual(2);
      expect(metrics.durationSeconds).toBeGreaterThan(0);
      expect(metrics.formattedDuration).toBeTruthy();
    });

    it("deve lidar com ausência de comentários retornando métricas zeradas", () => {
      const metrics = calculateExecutionMetrics([], null);
      expect(metrics.totalSubagents).toBe(0);
      expect(metrics.totalArtifacts).toBe(0);
      expect(metrics.totalEdits).toBe(0);
      expect(metrics.durationSeconds).toBe(0);
    });
  });
});
