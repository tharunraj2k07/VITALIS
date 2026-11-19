import { describe, expect, it } from "vitest";
import { calculateBaselines, detectAlerts } from "./baseline.js";
import { simulateMission } from "./simulator.js";

describe("deterministic mission simulator", () => {
  it("repeats the same metrics for the same seed and crew", () => {
    expect(simulateMission({ seed: 42, crewId: "a", days: 30 }))
      .toEqual(simulateMission({ seed: 42, crewId: "a", days: 30 }));
  });

  it("changes the designated metrics when a scenario is injected", () => {
    const normal = simulateMission({ seed: 9, days: 10 });
    const deprived = simulateMission({
      seed: 9, days: 10, scenarios: [{ type: "sleep_deprivation", startDay: 4, durationDays: 2 }],
    });
    expect(deprived[4].metrics.sleep_hours).toBeLessThan(normal[4].metrics.sleep_hours);
    expect(normal[4].metrics.sleep_hours - deprived[4].metrics.sleep_hours).toBe(2.7);
    expect(deprived[7].metrics.sleep_hours).toBe(normal[7].metrics.sleep_hours);
    expect(normal[7].phase).toBe("launch_adaptation");
  });

  it("repeats the same alerts for the same seeded mission", () => {
    const firstMission = simulateMission({
      seed: 7, crewId: "a", days: 32,
      scenarios: [{ type: "sleep_deprivation", startDay: 14, durationDays: 4 }],
    });
    const secondMission = simulateMission({
      seed: 7, crewId: "a", days: 32,
      scenarios: [{ type: "sleep_deprivation", startDay: 14, durationDays: 4 }],
    });
    expect(detectAlerts(firstMission, calculateBaselines(firstMission)))
      .toEqual(detectAlerts(secondMission, calculateBaselines(secondMission)));
  });

  it("supports very short missions and clamps invalid day counts to one observation", () => {
    expect(simulateMission({ days: 1 })).toHaveLength(1);
    expect(simulateMission({ days: 0 })).toHaveLength(1);
    expect(simulateMission({ days: -5 })).toHaveLength(1);
    const oneDay = simulateMission({ days: 1 });
    expect(detectAlerts(oneDay, calculateBaselines(oneDay))).toEqual([]);
  });
});
