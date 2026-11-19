import { describe, expect, it } from "vitest";
import { buildChartData } from "./dashboard-data";
import type { HealthAlert, Observation } from "@vitalis/core";

const observation: Observation = {
  crewId: "crew-1", day: 8, phase: "mid_mission",
  metrics: {
    resting_hr: 74, systolic_bp: 130, diastolic_bp: 80, spo2: 98, skin_temp: 36.5,
    sleep_hours: 5, sleep_efficiency: 70, exercise_minutes: 30,
    radiation_dose_cumulative: 1, mood: 5, congestion: 2, reaction_time: 0.5,
  },
};
const alert: HealthAlert = {
  id: "alert-1", crewId: "crew-1", day: 8, metric: "resting_hr", severity: "amber",
  status: "open", value: 74, baselineMean: 60, baselineStd: 3, zScore: 2.2, explanation: "Drift.",
};

describe("metric chart data", () => {
  it("marks only the matching metric and mission day as flagged", () => {
    expect(buildChartData([observation], [alert], "resting_hr")).toEqual([
      { day: 8, value: 74, flagged: true, zScore: 2.2 },
    ]);
    expect(buildChartData([observation], [alert], "sleep_hours")[0].flagged).toBe(false);
  });

  it("shows a baseline z-score and flags merged related metrics", () => {
    const merged: HealthAlert = { ...alert, metric: "resting_hr", relatedMetrics: ["resting_hr", "sleep_hours"] };
    expect(buildChartData([observation], [merged], "sleep_hours", { mean: 7, std: 1 })).toEqual([
      { day: 8, value: 5, flagged: true, zScore: -2 },
    ]);
  });
});
