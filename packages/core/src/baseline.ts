import type { BaselineStat, DomainScore, HealthAlert, MetricName, Observation } from "./types.js";

export interface BaselineOptions {
  startDay?: number;
  endDay?: number;
}

export interface DetectionOptions {
  amberZ?: number;
  redZ?: number;
  redSustainedDays?: number;
  ewmaAlpha?: number;
  cusumThreshold?: number;
}

export const metricDomains: Record<MetricName, DomainScore["domain"]> = {
  resting_hr: "cardiovascular",
  systolic_bp: "cardiovascular",
  diastolic_bp: "cardiovascular",
  spo2: "sleep_immune",
  skin_temp: "sleep_immune",
  sleep_hours: "sleep_immune",
  sleep_efficiency: "sleep_immune",
  exercise_minutes: "musculoskeletal",
  radiation_dose_cumulative: "radiation",
  mood: "behavioral_cognitive",
  congestion: "sleep_immune",
  reaction_time: "behavioral_cognitive",
};

export function calculateBaselines(
  observations: Observation[],
  options: BaselineOptions = {},
): BaselineStat[] {
  const startDay = options.startDay ?? 0;
  const endDay = options.endDay ?? 6;
  return (Object.keys(metricDomains) as MetricName[]).flatMap((metric) => {
    const values = observations
      .filter((row) => row.day >= startDay && row.day <= endDay)
      .map((row) => row.metrics[metric])
      .filter(Number.isFinite);
    if (values.length === 0) return [];
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    return [{ metric, mean, std: Math.sqrt(variance), sampleCount: values.length }];
  });
}

export function detectAlerts(
  observations: Observation[],
  baselines: BaselineStat[],
  options: DetectionOptions = {},
): HealthAlert[] {
  const amberZ = options.amberZ ?? 2;
  const redZ = options.redZ ?? 3;
  const redSustainedDays = options.redSustainedDays ?? 2;
  const alpha = options.ewmaAlpha ?? 0.4;
  const cusumThreshold = options.cusumThreshold ?? 5;
  const stats = new Map(baselines.map((stat) => [stat.metric, stat]));
  const byMetric = new Map<MetricName, Observation[]>();
  for (const row of observations) {
    for (const metric of Object.keys(metricDomains) as MetricName[]) {
      if (!Number.isFinite(row.metrics[metric])) continue;
      const group = byMetric.get(metric) ?? [];
      group.push(row);
      byMetric.set(metric, group);
    }
  }
  const alerts: HealthAlert[] = [];

  for (const [metric, rows] of byMetric) {
    const baseline = stats.get(metric);
    if (!baseline || baseline.sampleCount < 2) continue;
    const std = Number.isFinite(baseline.std) && baseline.std > 0 ? baseline.std : minimumScale[metric];
    let ewma = 0;
    let posCusum = 0;
    let negCusum = 0;
    let redRun = 0;
    let recoveryRun = 0;
    let active = false;
    let activeSeverity: HealthAlert["severity"] | undefined;
    let lastDay: number | undefined;
    let signalStartDay: number | undefined;
    for (const row of rows.sort((a, b) => a.day - b.day)) {
      if (lastDay !== undefined && row.day !== lastDay + 1) {
        redRun = 0;
        recoveryRun = 0;
      }
      lastDay = row.day;
      const value = row.metrics[metric];
      const rawZ = (value - baseline.mean) / std;
      ewma = alpha * rawZ + (1 - alpha) * ewma;
      posCusum = Math.max(0, posCusum + rawZ - 0.5);
      negCusum = Math.max(0, negCusum - rawZ - 0.5);
      const absoluteZ = Math.abs(ewma);
      redRun = absoluteZ >= redZ ? redRun + 1 : 0;
      recoveryRun = active && absoluteZ < amberZ && Math.max(posCusum, negCusum) < cusumThreshold
        ? recoveryRun + 1
        : 0;
      if (recoveryRun >= 3) {
        posCusum = 0;
        negCusum = 0;
        active = false;
        activeSeverity = undefined;
        signalStartDay = undefined;
      }
      const cusum = Math.max(posCusum, negCusum);
      const triggered = absoluteZ >= amberZ || cusum >= cusumThreshold;
      if (!triggered) {
        active = false;
        activeSeverity = undefined;
        signalStartDay = undefined;
        continue;
      }
      signalStartDay ??= row.day;
      const severity = absoluteZ >= redZ && redRun >= redSustainedDays ? "red" : "amber";
      if (active && (severity !== "red" || activeSeverity === "red")) continue;
      const deviation = value - baseline.mean;
      const direction = deviation >= 0 ? "above" : "below";
      const unit = metricUnits[metric];
      const reason = cusum >= cusumThreshold && absoluteZ < amberZ
        ? "a gradual cumulative change"
        : "a sustained change in the recent readings";
      alerts.push({
        id: `${row.crewId}-${row.day}-${metric}`,
        crewId: row.crewId,
        day: row.day,
        metric,
        severity,
        status: "open",
        value,
        baselineMean: baseline.mean,
        baselineStd: std,
        zScore: ewma,
        explanation: `On mission day ${row.day + 1}, ${metric.replaceAll("_", " ")} was ${Math.abs(deviation).toFixed(1)} ${unit} ${direction} this crew member's preflight baseline (average ${baseline.mean.toFixed(1)} ${unit}). The change was tracked from mission day ${(signalStartDay ?? row.day) + 1} through day ${row.day + 1} and reflects ${reason}.`,
      });
      active = true;
      activeSeverity = severity;
    }
  }
  const grouped = new Map<string, HealthAlert[]>();
  for (const alert of alerts) {
    const domain = metricDomains[alert.metric];
    const key = `${alert.crewId}:${alert.day}:${domain}`;
    grouped.set(key, [...(grouped.get(key) ?? []), alert]);
  }
  return [...grouped.values()].map<HealthAlert>((group) => {
    if (group.length === 1) return group[0];
    const primary = [...group].sort((a, b) =>
      (b.severity === "red" ? 1 : 0) - (a.severity === "red" ? 1 : 0)
      || Math.abs(b.zScore) - Math.abs(a.zScore)
      || a.metric.localeCompare(b.metric))[0];
    const relatedMetrics = group.map((alert) => alert.metric).sort();
    return {
      ...primary,
      id: `${primary.crewId}-${primary.day}-${metricDomains[primary.metric]}`,
      relatedMetrics,
      severity: group.some((alert) => alert.severity === "red") ? "red" : "amber",
      explanation: group.map((alert) => alert.explanation).join(" "),
    };
  }).sort((a, b) => a.day - b.day || a.metric.localeCompare(b.metric));
}

export function calculateDomainScores(
  latest: Observation,
  baselines: BaselineStat[],
  missionDoseBudget = 4,
): DomainScore[] {
  const doseBudget = Number.isFinite(missionDoseBudget) && missionDoseBudget > 0 ? missionDoseBudget : 4;
  const baselineMap = new Map(baselines.map((stat) => [stat.metric, stat]));
  return domainNames.map((domain) => {
    const metrics = (Object.keys(metricDomains) as MetricName[])
      .filter((metric) => metricDomains[metric] === domain);
    const deductions = metrics.map((metric) => {
      if (metric === "radiation_dose_cumulative") {
        return Math.min(100, Math.max(0, latest.metrics[metric] / doseBudget * 100));
      }
      const baseline = baselineMap.get(metric);
      if (!baseline) return 0;
      const value = Number.isFinite(latest.metrics[metric]) ? latest.metrics[metric] : baseline.mean;
      const scale = Number.isFinite(baseline.std) && baseline.std > 0 ? baseline.std : minimumScale[metric];
      const z = Math.abs((value - baseline.mean) / scale);
      return Math.min(60, Math.max(0, z - 1) * 18);
    });
    const score = Math.min(100, Math.max(0, Math.round(100 - deductions.reduce((sum, item) => sum + item, 0) / Math.max(1, deductions.length))));
    return { domain, score, explanation: `Score reflects deviation from this crew member's baseline${domain === "radiation" ? " and the configured mission dose budget" : ""}.` };
  });
}

const domainNames: DomainScore["domain"][] = [
  "cardiovascular", "sleep_immune", "musculoskeletal", "radiation", "behavioral_cognitive",
];

const minimumScale: Record<MetricName, number> = {
  resting_hr: 1, systolic_bp: 2, diastolic_bp: 2, spo2: 0.5, skin_temp: 0.2,
  sleep_hours: 0.4, sleep_efficiency: 3, exercise_minutes: 6,
  radiation_dose_cumulative: 0.02, mood: 0.5, congestion: 0.5, reaction_time: 0.03,
};

const metricUnits: Record<MetricName, string> = {
  resting_hr: "bpm", systolic_bp: "mmHg", diastolic_bp: "mmHg", spo2: "percentage points",
  skin_temp: "°C", sleep_hours: "hours", sleep_efficiency: "percentage points",
  exercise_minutes: "minutes", radiation_dose_cumulative: "mission-dose units",
  mood: "points", congestion: "points", reaction_time: "seconds",
};
