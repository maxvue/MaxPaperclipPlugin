const NEW_TASK_LABELS = ["new issue", "new task", "nova tarefa"];

function hasNewTaskLabel(button: HTMLButtonElement): boolean {
  const text = button.textContent?.toLowerCase() ?? "";
  const ariaLabel = button.getAttribute("aria-label")?.toLowerCase() ?? "";

  return NEW_TASK_LABELS.some(
    (label) => text.includes(label) || ariaLabel.includes(label),
  );
}

/**
 * Localiza o acionador nativo do Paperclip sem recapturar os botões do plugin.
 */
export function findNativeNewTaskButton(
  document: Document,
  pluginPanel: Element | null,
): HTMLButtonElement | null {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));

  return (
    buttons.find(
      (button) =>
        !pluginPanel?.contains(button) &&
        !button.disabled &&
        hasNewTaskLabel(button) &&
        button.offsetParent !== null,
    ) ?? null
  );
}
