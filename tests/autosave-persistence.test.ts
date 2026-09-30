// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { autoSaveEngine } from "../src/modules/autosave/engine.js";
import { updateSetting } from "../src/config/settings.js";

describe("Confirmação de persistência do Auto-save", () => {
  beforeEach(() => {
    updateSetting("autosave", true);
    window.history.pushState({}, "", "/ENG/agents/agente/config");
    document.body.innerHTML = "";
  });

  it("aguarda a Promise de onSave antes de informar sucesso", async () => {
    let resolveSave!: () => void;
    const input = document.createElement("input");
    (input as unknown as Record<string, unknown>)["__reactFiber$teste"] = {
      memoizedProps: {
        onSave: () => new Promise<void>((resolve) => { resolveSave = resolve; }),
      },
    };
    document.body.appendChild(input);
    input.focus();

    autoSaveEngine.executeSave();
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(autoSaveEngine.currentStatus).not.toBe("saved");

    resolveSave();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(autoSaveEngine.currentStatus).toBe("saved");
  });

  it("classifica clique em botão como solicitação, sem afirmar persistência", async () => {
    const form = document.createElement("form");
    const input = document.createElement("input");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.testid = "save-settings";
    button.textContent = "Save changes";
    form.append(input, button);
    document.body.appendChild(form);
    input.focus();

    autoSaveEngine.executeSave();
    await new Promise((resolve) => setTimeout(resolve, 90));

    expect(autoSaveEngine.currentStatus).toBe("requested");
  });

  it("persiste o campo capturado mesmo quando o foco muda antes do callback", async () => {
    const saveOriginal = vi.fn();
    const saveNovo = vi.fn();
    const original = document.createElement("input");
    original.value = "valor original";
    (original as unknown as Record<string, unknown>)["__reactFiber$original"] = {
      memoizedProps: { onSave: saveOriginal },
    };
    const novo = document.createElement("input");
    novo.value = "outro valor";
    (novo as unknown as Record<string, unknown>)["__reactFiber$novo"] = {
      memoizedProps: { onSave: saveNovo },
    };
    document.body.append(original, novo);
    original.focus();

    autoSaveEngine.executeSave();
    window.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    novo.focus();
    await new Promise((resolve) => setTimeout(resolve, 90));

    expect(saveOriginal).toHaveBeenCalledWith("valor original");
    expect(saveNovo).not.toHaveBeenCalled();
  });

  it("não permite que uma persistência antiga sobrescreva uma edição mais nova", async () => {
    let resolveSave!: () => void;
    const input = document.createElement("input");
    (input as unknown as Record<string, unknown>)["__reactFiber$pendente"] = {
      memoizedProps: {
        onSave: () => new Promise<void>((resolve) => { resolveSave = resolve; }),
      },
    };
    document.body.appendChild(input);
    input.focus();

    autoSaveEngine.executeSave();
    await new Promise((resolve) => setTimeout(resolve, 90));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(autoSaveEngine.currentStatus).toBe("in_debounce");

    resolveSave();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(autoSaveEngine.currentStatus).toBe("in_debounce");
  });
});
