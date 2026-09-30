// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionItem } from "../src/modules/chat-sessions/SessionItem.js";
import type { ChatSession } from "../src/modules/chat-sessions/types.js";

const session: ChatSession = {
  id: "session-gen-2",
  agentRef: "agente-teste",
  companyId: "empresa-1",
  issueId: "conversa-123",
  generation: 2,
  title: "Conversa de teste",
  createdAt: "2026-09-30T10:00:00.000Z",
  updatedAt: "2026-09-30T10:00:00.000Z",
  messagesCount: 1,
  snippet: "Mensagem de teste",
};

describe("Item da lista de sessões", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const writeText = vi.fn<Clipboard["writeText"]>();
  const onSelect = vi.fn();

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("exibe as ações antes da data e hora", () => {
    act(() => {
      root.render(React.createElement(SessionItem, {
        session,
        isActive: false,
        onSelect,
        onRename: vi.fn(),
      }));
    });

    const copyButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Copiar ID da conversa"]',
    );
    const actions = copyButton?.parentElement;
    const dateTime = actions?.nextElementSibling;

    expect(copyButton).not.toBeNull();
    expect(actions?.tagName).toBe("DIV");
    expect(dateTime?.tagName).toBe("SPAN");
  });

  it("copia o ID da conversa sem selecionar a sessão", async () => {
    act(() => {
      root.render(React.createElement(SessionItem, {
        session,
        isActive: false,
        onSelect,
        onRename: vi.fn(),
      }));
    });

    const copyButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Copiar ID da conversa"]',
    );
    await act(async () => copyButton?.click());

    expect(writeText).toHaveBeenCalledWith("conversa-123");
    expect(onSelect).not.toHaveBeenCalled();
    expect(copyButton?.getAttribute("aria-label")).toBe("ID da conversa copiado");
  });
});
