import { describe, expect, it } from "vitest";
import { calculateBaselines, calculateDomainScores, detectAlerts, metricDomains } from "./baseline.js";
import type { Observation } from "./types.js";

const row = (day: number, hr: number): Observation => ({
  crewId: "test",
  day,
  phase: day < 7 ? "preflight" : "mid_mission",
  metrics: {
    resting_hr: hr, systolic_bp: 110, diastolic_bp: 70, spo2: 98, skin_temp: 36.5,
    sleep_hours: 7.5, sleep_efficiency: 90, exercise_minutes: 50,
    radiation_dose_cumulative: day * 0.02, mood: 7, congestion: 1, reaction_time: 0.4,
  },
});

describe("personal baseline engine", () => {
  it("uses the preflight window and identifies sustained red drift with an explanation", () => {
    const observations = [row(0, 60), row(1, 62), row(2, 60), row(3, 62), row(7, 75), row(8, 75), row(9, 75)];
    const baselines = calculateBaselines(observations);
    const heart = baselines.find((item) => item.metric === "resting_hr")!;
    expect(heart.mean).toBe(61);
    const alerts = detectAlerts(observations, baselines);
    expect(alerts.some((alert) => alert.severity === "red" && alert.day === 8)).toBe(true);
    expect(alerts[0].explanation).toContain("preflight baseline");
    expect(alerts[0].explanation).toContain("recent readings");
  });

  it("returns five bounded domain scores", () => {
    const observations = [row(0, 60), row(1, 62)];
    const scores = calculateDomainScores(row(2, 61), calculateBaselines(observations));
    expect(scores).toHaveLength(5);
    expect(scores.every((score) => score.score >= 0 && score.score <= 100)).toBe(true);
  });

  it("calculates known EWMA z-scores and fires CUSUM on the expected day", () => {
    const baseline = [{ metric: "resting_hr" as const, mean: 60, std: 2, sampleCount: 7 }];
    const highSeries = [row(0, 76), row(1, 76)];
    const red = detectAlerts(highSeries, baseline);
    expect(red.map(({ day, severity, zScore }) => ({ day, severity, zScore }))).toEqual([
      { day: 0, severity: "amber", zScore: 3.2 },
      { day: 1, severity: "red", zScore: 5.12 },
    ]);

    const gradual = Array.from({ length: 11 }, (_, day) => row(day, 62));
    const cusum = detectAlerts(gradual, baseline);
    expect(cusum).toHaveLength(1);
    expect(cusum[0].day).toBe(9);
    expect(cusum[0].zScore).toBeCloseTo(0.993953, 6);
  });

  it("does not count missing days toward sustained red and enforces amber threshold", () => {
    const baseline = [{ metric: "resting_hr" as const, mean: 60, std: 2, sampleCount: 7 }];
    const gapSeries = [row(0, 76), row(2, 76)];
    const alerts = detectAlerts(gapSeries, baseline);
    expect(alerts.every((alert) => alert.severity === "amber")).toBe(true);
    expect(detectAlerts([row(0, 63)], baseline)).toEqual([]);
  });

  it("uses a finite scale for zero-variance baselines and bounds scores for out-of-range readings", () => {
    const constant = [row(0, 60), row(1, 60)];
    const baselines = calculateBaselines(constant);
    expect(baselines.find((item) => item.metric === "resting_hr")?.std).toBe(0);
    const drift = detectAlerts([row(0, 60), row(1, 60), row(2, 65)], baselines);
    expect(drift.some((alert) => Number.isFinite(alert.zScore))).toBe(true);
    const extreme = row(2, 100000);
    extreme.metrics.radiation_dose_cumulative = 100000;
    const scores = calculateDomainScores(extreme, baselines, 0);
    expect(scores.every((score) => Number.isFinite(score.score) && score.score >= 0 && score.score <= 100)).toBe(true);
  });

  it("merges same-day alerts in one domain with a combined plain-language explanation", () => {
    const baseline = [
      { metric: "sleep_hours" as const, mean: 7, std: 0.5, sampleCount: 7 },
      { metric: "sleep_efficiency" as const, mean: 90, std: 3, sampleCount: 7 },
    ];
    const first = row(0, 60);
    first.metrics.sleep_hours = 3;
    first.metrics.sleep_efficiency = 65;
    const alerts = detectAlerts([first], baseline);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].relatedMetrics).toEqual(["sleep_efficiency", "sleep_hours"]);
    expect(alerts[0].explanation).toContain("preflight baseline");
    expect(alerts[0].explanation).toContain("mission day 1");
    expect(metricDomains[alerts[0].metric]).toBe("sleep_immune");
  });

  it("degrades domain scores monotonically as baseline drift grows", () => {
    const reference = row(0, 60);
    const baselines = (Object.keys(metricDomains) as (keyof typeof metricDomains)[]).map((metric) => ({
      metric, mean: reference.metrics[metric], std: 1, sampleCount: 7,
    }));
    const driftCases = {
      cardiovascular: ["resting_hr", 1000],
      sleep_immune: ["sleep_hours", -1000],
      musculoskeletal: ["exercise_minutes", -1000],
      radiation: ["radiation_dose_cumulative", 1000],
      behavioral_cognitive: ["mood", -1000],
    } as const;
    for (const [domain, [metric, value]] of Object.entries(driftCases)) {
      const drifted = { ...reference, metrics: { ...reference.metrics, [metric]: value } };
      const referenceScore = calculateDomainScores(reference, baselines).find((score) => score.domain === domain)!.score;
      const driftedScore = calculateDomainScores(drifted, baselines).find((score) => score.domain === domain)!.score;
      expect(driftedScore).toBeLessThanOrEqual(referenceScore);
      expect(driftedScore).toBeGreaterThanOrEqual(0);
      expect(driftedScore).toBeLessThanOrEqual(100);
    }
  });

  it("uses the documented amber and red thresholds with a two-day red sustain", () => {
    const baseline = [{ metric: "resting_hr" as const, mean: 60, std: 2, sampleCount: 7 }];
    const exactAmber = detectAlerts([row(0, 64)], baseline, {
      ewmaAlpha: 1, cusumThreshold: 100,
    });
    expect(exactAmber).toHaveLength(1);
    expect(exactAmber[0].severity).toBe("amber");
    expect(detectAlerts([row(0, 63.98)], baseline, {
      ewmaAlpha: 1, cusumThreshold: 100,
    })).toEqual([]);
    const redRun = detectAlerts([row(0, 66), row(1, 66)], baseline, {
      ewmaAlpha: 1, cusumThreshold: 100,
    });
    expect(redRun.map((alert) => [alert.day, alert.severity])).toEqual([
      [0, "amber"], [1, "red"],
    ]);
  });
});
