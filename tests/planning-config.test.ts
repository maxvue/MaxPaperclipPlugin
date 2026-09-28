import { describe, expect, it } from "vitest";
import {
  buildProjectPlanningConfig,
  isPlanningLeaderEligible,
} from "../src/planning-config.js";

const leaderId = "07a2f2ea-8f1a-4b5e-996c-8821032e8e6d";

describe("configuração do planejamento assistido", () => {
  it("considera invocável um líder após erro recuperável", () => {
    expect(isPlanningLeaderEligible({ id: leaderId, status: "error" })).toBe(true);
    expect(isPlanningLeaderEligible({ id: leaderId, status: "paused" })).toBe(false);
  });

  it("não aceita executor comum como líder de planejamento", () => {
    expect(isPlanningLeaderEligible({
      id: "33333333-3333-4333-8333-333333333333",
      status: "idle",
    })).toBe(false);
  });

  it("torna obrigatórias as aprovações de escopo e técnica", () => {
    expect(buildProjectPlanningConfig(leaderId, "2026-09-28T00:00:00.000Z")).toEqual({
      enabled: true,
      planningAgentId: leaderId,
      requireScopeApproval: true,
      requireTechnicalApproval: true,
      updatedAt: "2026-09-28T00:00:00.000Z",
    });
  });
});
