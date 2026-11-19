import { describe, expect, it } from "vitest";
import { matchProtocol, safeProtocol } from "./protocol-engine.js";
import type { HealthAlert, Protocol } from "./types.js";
import protocolData from "../../../data/protocols.json";

const alert: HealthAlert = {
  id: "c-10-systolic_bp", crewId: "c", day: 10, metric: "systolic_bp",
  severity: "amber", status: "open", value: 130, baselineMean: 110,
  baselineStd: 3, zScore: 2.4, explanation: "Personal baseline drift.",
};

const protocol: Protocol = {
  id: "bp", domain: "cardiovascular", title: "BP drift", tier: "escalate",
  trigger: { any_metric: ["systolic_bp"], min_severity: "amber" },
  non_drug_steps: ["Record the reading."],
  medication_category: { class: "must-not-appear", note: "dose per official onboard procedure" },
  escalate_if: ["Contact ground / emergency procedure."],
  sources: [{ title: "TODO", url: "TODO" }], verified: false,
  disclaimer: "Decision support only, not medical advice.",
};

describe("declarative protocol matching", () => {
  it("matches the alert and never returns medication guidance for escalate-tier protocols", () => {
    const matched = matchProtocol(alert, [protocol]);
    expect(matched?.id).toBe("bp");
    expect(matched?.medication_category).toBeNull();
  });

  it("does not match unrelated metrics", () => {
    expect(matchProtocol({ ...alert, metric: "mood" }, [protocol])).toBeUndefined();
  });

  it("strips medication guidance even if an escalate protocol is malformed", () => {
    expect(safeProtocol(protocol).medication_category).toBeNull();
  });

  it("prioritizes general escalation for red alerts", () => {
    const general: Protocol = {
      ...protocol, id: "general-escalation", title: "General urgent escalation",
      trigger: { min_severity: "red" }, tier: "escalate",
    };
    expect(matchProtocol({ ...alert, severity: "red" }, [protocol, general])?.id).toBe("general-escalation");
  });

  it("never exposes medication guidance from any escalation-tier protocol", () => {
    const escalationProtocols = [protocol, {
      ...protocol, id: "general-escalation", trigger: { min_severity: "red" },
    }];
    for (const escalation of escalationProtocols) {
      expect(safeProtocol(escalation).medication_category).toBeNull();
      expect(matchProtocol({ ...alert, severity: "red" }, [escalation])?.medication_category).toBeNull();
    }
  });

  it("safety-filters every real escalation-tier protocol", () => {
    const escalationProtocols = (protocolData as Protocol[]).filter((item) => item.tier === "escalate");
    expect(escalationProtocols.length).toBeGreaterThan(0);
    for (const item of escalationProtocols) {
      const metric = (item.trigger as { any_metric?: HealthAlert["metric"][] }).any_metric?.[0] ?? "resting_hr";
      const matched = matchProtocol({ ...alert, metric, severity: "red" }, [item]);
      expect(matched?.medication_category).toBeNull();
    }
  });

  it("matches combined alerts through any related metric and omits unrelated triggers", () => {
    const combined: HealthAlert = { ...alert, metric: "sleep_hours", relatedMetrics: ["sleep_hours", "sleep_efficiency"] };
    const efficiency = { ...protocol, trigger: { any_metric: ["sleep_efficiency"], min_severity: "amber" as const } };
    expect(matchProtocol(combined, [efficiency])?.id).toBe("bp");
    expect(matchProtocol({ ...alert, metric: "mood" }, [protocol])).toBeUndefined();
  });
});
