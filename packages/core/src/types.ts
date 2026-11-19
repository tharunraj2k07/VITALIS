export const metricNames = [
  "resting_hr", "systolic_bp", "diastolic_bp", "spo2", "skin_temp",
  "sleep_hours", "sleep_efficiency", "exercise_minutes",
  "radiation_dose_cumulative", "mood", "congestion", "reaction_time",
] as const;

export type MetricName = (typeof metricNames)[number];
export type MissionPhase = "preflight" | "launch_adaptation" | "mid_mission" | "return";
export type ScenarioType =
  | "sleep_deprivation"
  | "bp_drift"
  | "solar_particle_event"
  | "isolation_mood_decline"
  | "bone_muscle_decline";
export type AlertSeverity = "amber" | "red";
export type AlertStatus = "open" | "acknowledged" | "resolved";
export type ProtocolTier = "self_manage" | "monitor" | "escalate";

export interface Observation {
  crewId: string;
  day: number;
  phase: MissionPhase;
  metrics: Record<MetricName, number>;
}

export interface BaselineStat {
  metric: MetricName;
  mean: number;
  std: number;
  sampleCount: number;
}

export interface DomainScore {
  domain: "cardiovascular" | "sleep_immune" | "musculoskeletal" | "radiation" | "behavioral_cognitive";
  score: number;
  explanation: string;
}

export interface HealthAlert {
  id: string;
  crewId: string;
  day: number;
  metric: MetricName;
  severity: AlertSeverity;
  status: AlertStatus;
  value: number;
  baselineMean: number;
  baselineStd: number;
  zScore: number;
  explanation: string;
  relatedMetrics?: MetricName[];
}

export interface Protocol {
  id: string;
  domain: DomainScore["domain"];
  title: string;
  tier: ProtocolTier;
  trigger: Record<string, unknown>;
  non_drug_steps: string[];
  medication_category: { class: string; note: string } | null;
  escalate_if: string[];
  sources: { title: string; url: string }[];
  verified: boolean;
  disclaimer: string;
}
