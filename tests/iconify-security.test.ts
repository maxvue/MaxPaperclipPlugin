// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { iconifyEngine, sanitizeIconSvg } from "../src/modules/iconify/engine.js";
import { iconifyCache } from "../src/modules/iconify/cache.js";

describe("Sanitização de SVG do Iconify", () => {
  afterEach(() => {
    iconifyEngine.setEnabled(false);
    iconifyCache.clear();
    document.body.innerHTML = "";
  });
  it("remove scripts, eventos e referências externas", () => {
    const result = sanitizeIconSvg(
      `<svg viewBox="0 0 24 24" onload="alert(1)">
        <script>alert(1)</script>
        <path d="M0 0" onclick="alert(2)" fill="url(https://evil.example/x)" />
        <a href="javascript:alert(3)"><circle cx="1" cy="1" r="1" /></a>
      </svg>`,
      "1em",
    );

    expect(result).not.toBeNull();
    expect(result).not.toMatch(/script|onload|onclick|javascript:|evil\.example/i);
    expect(result).not.toContain("<a");
  });

  it("preserva somente referências locais seguras", () => {
    const result = sanitizeIconSvg(
      `<svg viewBox="0 0 24 24"><defs><clipPath id="ok"><path d="M0 0" /></clipPath></defs><path clip-path="url(#ok)" d="M1 1" /></svg>`,
      "24px",
    );

    expect(result).toContain("url(#ok)");
    expect(result).toContain('width="24px"');
    expect(result).toContain('aria-hidden="true"');
  });

  it("sanitiza novamente entradas antigas do cache antes de inserir no DOM", async () => {
    iconifyEngine.setEnabled(false);
    const parsed = iconifyEngine.parseIconTag("<i lucide:home>", "lucide:home")!;
    iconifyCache.set(
      parsed.cacheKey,
      '<svg onload="alert(1)"><script>malicioso</script><path d="M0 0" /></svg>',
    );
    document.body.textContent = "<i lucide:home>";

    iconifyEngine.setEnabled(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelector("svg")).not.toBeNull();
    expect(document.querySelector("svg[onload]")).toBeNull();
    expect(document.querySelector("svg script")).toBeNull();
  });
});
