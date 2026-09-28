// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  parseChatRoute,
  isSessionStartMarker,
  applySessionVisibility,
} from "../src/modules/chat-sessions/engine.js";
import {
  generateSessionTitle,
  groupCommentsIntoSessions,
  filterSessions,
  saveCustomTitle,
  loadCustomTitles,
  type RawIssueComment,
} from "../src/modules/chat-sessions/store.js";
import type { ChatSession, ChatMessage } from "../src/modules/chat-sessions/types.js";

describe("MaxPaperclipPlugin - Módulo de Sessões de Chat (Chat Sessions)", () => {
  describe("Roteamento e Detecção de Tela de Chat", () => {
    it("deve identificar corretamente rotas de chat com agentes", () => {
      const res = parseChatRoute("/ENG/chats/l-der-de-auditoria");
      expect(res.isChat).toBe(true);
      expect(res.companyPrefix).toBe("ENG");
      expect(res.agentRef).toBe("l-der-de-auditoria");
    });

    it("deve ignorar rotas que não sejam chats de agentes", () => {
      expect(parseChatRoute("/ENG/issues/ENG-45").isChat).toBe(false);
      expect(parseChatRoute("/ENG/agents/l-der-de-auditoria/overview").isChat).toBe(false);
      expect(parseChatRoute("/ENG/dashboard").isChat).toBe(false);
      expect(parseChatRoute("").isChat).toBe(false);
    });
  });

  describe("Geração Inteligente de Títulos de Sessão", () => {
    it("deve extrair títulos concisos a partir da primeira mensagem do usuário", () => {
      const title1 = generateSessionTitle("Como você pode auditar o fluxo de deploy?", 0);
      expect(title1).toBe("Como você pode auditar o fluxo de…");

      const title2 = generateSessionTitle("Olá, bom dia!", 0);
      expect(title2).toBe("Olá, bom dia!");
    });

    it("deve limpar comandos como /ask e usar fallback caso não haja texto", () => {
      const titleCmd = generateSessionTitle("/ask Me ajude a refatorar o banco", 1);
      expect(titleCmd).toBe("Me ajude a refatorar o banco");

      const titleEmpty = generateSessionTitle("", 2);
      expect(titleEmpty).toBe("Sessão 3");

      const titleNull = generateSessionTitle(null, 0);
      expect(titleNull).toBe("Sessão 1");
    });
  });

  describe("Agrupamento de Comentários em Sessões (/new e Session Generation)", () => {
    it("deve criar uma única sessão quando não há marcadores /new", () => {
      const comments: RawIssueComment[] = [
        {
          id: "c1",
          body: "Primeira pergunta do usuário",
          authorUserId: "user-1",
          createdAt: "2026-09-28T10:00:00Z",
        },
        {
          id: "c2",
          body: "Resposta do agente",
          authorAgentId: "agent-1",
          createdAt: "2026-09-28T10:01:00Z",
        },
      ];

      const { sessions, messagesBySession } = groupCommentsIntoSessions(
        "comp-1",
        "agent-1",
        "issue-1",
        comments,
      );

      expect(sessions).toHaveLength(1);
      expect(sessions[0].generation).toBe(0);
      expect(sessions[0].messagesCount).toBe(2);
      expect(sessions[0].title).toBe("Primeira pergunta do usuário");

      const msgs = messagesBySession.get(sessions[0].id) ?? [];
      expect(msgs).toHaveLength(2);
      expect(msgs[0].author).toBe("user");
      expect(msgs[1].author).toBe("agent");
    });

    it("deve dividir em múltiplas sessões quando houver /new ou conversationSessionGeneration", () => {
      const comments: RawIssueComment[] = [
        {
          id: "c1",
          body: "Sessão antiga: analisar banco",
          authorUserId: "user-1",
          createdAt: "2026-09-28T10:00:00Z",
        },
        {
          id: "c2",
          body: "O banco está normal",
          authorAgentId: "agent-1",
          createdAt: "2026-09-28T10:01:00Z",
        },
        {
          id: "c3",
          body: "/new",
          conversationSessionGeneration: 1,
          createdAt: "2026-09-28T10:05:00Z",
        },
        {
          id: "c4",
          body: "Sessão nova: verificar deploy no Kubernetes",
          authorUserId: "user-1",
          createdAt: "2026-09-28T10:06:00Z",
        },
        {
          id: "c5",
          body: "Verificação concluída sem falhas",
          authorAgentId: "agent-1",
          createdAt: "2026-09-28T10:07:00Z",
        },
      ];

      const { sessions, messagesBySession } = groupCommentsIntoSessions(
        "comp-1",
        "agent-1",
        "issue-1",
        comments,
      );

      expect(sessions).toHaveLength(2);

      // Sessão 1 (antiga)
      expect(sessions[0].generation).toBe(0);
      expect(sessions[0].title).toBe("Sessão antiga: analisar banco");
      expect(sessions[0].messagesCount).toBe(2);

      // Sessão 2 (nova)
      expect(sessions[1].generation).toBe(1);
      expect(sessions[1].title).toBe("Sessão nova: verificar deploy no…");
      expect(sessions[1].messagesCount).toBe(2);

      const msgsSess2 = messagesBySession.get(sessions[1].id) ?? [];
      expect(msgsSess2).toHaveLength(2);
      expect(msgsSess2[0].text).toContain("verificar deploy");
    });
  });

  describe("Busca e Filtragem de Sessões em Tempo Real", () => {
    const mockSessions: ChatSession[] = [
      {
        id: "sess-0",
        agentRef: "ag-1",
        companyId: "c-1",
        issueId: "i-1",
        generation: 0,
        title: "Auditoria de Logs",
        createdAt: "2026-09-28T10:00:00Z",
        updatedAt: "2026-09-28T10:00:00Z",
        messagesCount: 1,
        snippet: "Verifiquei os logs do Nginx",
      },
      {
        id: "sess-1",
        agentRef: "ag-1",
        companyId: "c-1",
        issueId: "i-1",
        generation: 1,
        title: "Configuração do PostgreSQL",
        createdAt: "2026-09-28T10:10:00Z",
        updatedAt: "2026-09-28T10:10:00Z",
        messagesCount: 1,
        snippet: "Ajuste na porta 5432",
      },
    ];

    const mockMessagesMap = new Map<string, ChatMessage[]>([
      [
        "sess-0",
        [
          {
            id: "m1",
            author: "user",
            text: "Precisamos verificar o erro 502 no gateway",
            createdAt: "2026-09-28T10:00:00Z",
          },
        ],
      ],
      [
        "sess-1",
        [
          {
            id: "m2",
            author: "user",
            text: "Atualize o pool de conexões do banco",
            createdAt: "2026-09-28T10:10:00Z",
          },
        ],
      ],
    ]);

    it("deve filtrar sessões pelo título", () => {
      const filtered = filterSessions(mockSessions, mockMessagesMap, "Postgre");
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe("sess-1");
    });

    it("deve filtrar sessões pelo conteúdo de mensagem interna", () => {
      const filtered = filterSessions(mockSessions, mockMessagesMap, "gateway");
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe("sess-0");
    });

    it("deve retornar todas as sessões quando a busca for vazia", () => {
      const filtered = filterSessions(mockSessions, mockMessagesMap, "   ");
      expect(filtered).toHaveLength(2);
    });

    it("deve retornar vazio quando o termo não existir em nenhuma sessão", () => {
      const filtered = filterSessions(mockSessions, mockMessagesMap, "termo-inexistente-xyz");
      expect(filtered).toHaveLength(0);
    });
  });

  describe("Visibilidade e Isolamento de Sessões no DOM", () => {
    beforeEach(() => {
      document.body.innerHTML = "";
    });

    it("deve identificar marcadores legítimos de início de sessão (/new) e ignorar avisos de falha", () => {
      // Marcador válido de nova sessão
      const divMarker = document.createElement("div");
      divMarker.innerHTML = '<div class="tc-enter-marker">New session · Earlier messages and files are still available.</div>';
      expect(isSessionStartMarker(divMarker)).toBe(true);

      // Marcador de falha (não é nova sessão)
      const divFailure = document.createElement("div");
      divFailure.innerHTML = '<div class="tc-enter-marker">Falha na execução · The run failed.</div>';
      expect(isSessionStartMarker(divFailure)).toBe(false);

      // Elemento comum de mensagem
      const divMsg = document.createElement("div");
      divMsg.innerHTML = '<div>Olá agente</div>';
      expect(isSessionStartMarker(divMsg)).toBe(false);
    });

    it("deve alternar a visibilidade das mensagens no DOM ao mudar a sessão ativa", () => {
      // Monta DOM simulado do Paperclip TaskChatThreadView
      const container = document.createElement("div");
      container.className = "paperclip-mobile-thread";

      // Header
      const header = document.createElement("div");
      header.setAttribute("data-testid", "task-chat-thread-header");
      container.appendChild(header);

      // Mensagem da Sessão 0
      const msg0 = document.createElement("div");
      msg0.setAttribute("data-thread-anchor", "msg-0");
      container.appendChild(msg0);

      // Marcador /new iniciando Sessão 1
      const marker1 = document.createElement("div");
      marker1.innerHTML = '<div class="tc-enter-marker">New session · Earlier messages...</div>';
      container.appendChild(marker1);

      // Mensagem da Sessão 1
      const msg1 = document.createElement("div");
      msg1.setAttribute("data-thread-anchor", "msg-1");
      container.appendChild(msg1);

      document.body.appendChild(container);

      // Seleciona Sessão 0
      applySessionVisibility(0, 2);
      expect(msg0.style.display).toBe("");
      expect(marker1.style.display).toBe("none");
      expect(msg1.style.display).toBe("none");

      // Seleciona Sessão 1
      applySessionVisibility(1, 2);
      expect(msg0.style.display).toBe("none");
      expect(marker1.style.display).toBe("none"); // divisor oculto para iniciar tela limpa
      expect(msg1.style.display).toBe("");
    });
  });
});
