// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { translationEngine } from "../src/modules/translator/engine.js";

describe("Regressões do tradutor", () => {
  afterEach(() => {
    translationEngine.deactivate();
    document.body.innerHTML = "";
  });

  it("não restaura texto antigo quando a aplicação atualizou o DOM depois da tradução", () => {
    document.body.innerHTML = "<span>Save changes</span>";
    const span = document.querySelector("span")!;

    translationEngine.walkAndTranslate(span);
    expect(span.textContent).not.toBe("Save changes");

    span.textContent = "Valor atualizado pela aplicação";
    translationEngine.walkAndRestore(document.body);

    expect(span.textContent).toBe("Valor atualizado pela aplicação");
  });
});
