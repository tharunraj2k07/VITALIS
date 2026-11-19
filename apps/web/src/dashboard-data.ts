import type { HealthAlert, MetricName, Observation } from "@vitalis/core";

export function buildChartData(
  observations: Observation[],
  alerts: HealthAlert[],
  metric: MetricName,
  baseline?: { mean: number; std: number },
): { day: number; value: number; flagged: boolean; zScore?: number }[] {
  return observations.map((row) => {
    const alert = alerts.find((item) =>
      item.day === row.day && (item.relatedMetrics ?? [item.metric]).includes(metric));
    const zScore = baseline
      ? (row.metrics[metric] - baseline.mean) / (baseline.std > 0 ? baseline.std : 1)
      : alert?.zScore;
    return {
      day: row.day,
      value: row.metrics[metric],
      flagged: alert !== undefined,
      ...(zScore === undefined ? {} : { zScore }),
    };
  });
}
