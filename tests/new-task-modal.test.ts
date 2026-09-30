import { describe, expect, it, vi } from "vitest";
import { findNativeNewTaskButton } from "../src/modules/tasks/newTask.js";

function createButton(options: {
  text?: string;
  ariaLabel?: string;
  visible?: boolean;
}) {
  return {
    textContent: options.text ?? "",
    disabled: false,
    offsetParent: options.visible === false ? null : {},
    getAttribute: (name: string) =>
      name === "aria-label" ? (options.ariaLabel ?? null) : null,
    click: vi.fn(),
  } as unknown as HTMLButtonElement;
}

function createDocument(buttons: HTMLButtonElement[]): Document {
  return {
    querySelectorAll: () => buttons,
  } as unknown as Document;
}

describe("abertura do modal nativo de nova tarefa", () => {
  it("ignora o próprio botão do painel e aciona o botão do Paperclip", () => {
    const pluginButton = createButton({ ariaLabel: "Nova tarefa em Projeto A" });
    const nativeButton = createButton({ ariaLabel: "New task" });
    const document = createDocument([pluginButton, nativeButton]);
    const pluginPanel = {
      contains: (element: Element) => element === pluginButton,
    } as unknown as Element;

    const button = findNativeNewTaskButton(document, pluginPanel);
    button?.click();

    expect(button).toBe(nativeButton);
    expect(nativeButton.click).toHaveBeenCalledOnce();
    expect(pluginButton.click).not.toHaveBeenCalled();
  });

  it("não seleciona um acionador nativo oculto", () => {
    const hiddenButton = createButton({ ariaLabel: "New Task", visible: false });

    expect(findNativeNewTaskButton(createDocument([hiddenButton]), null)).toBeNull();
  });
});
