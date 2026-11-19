import type { MissionPhase } from "./types.js";

export const missionLengthDays = 180;

export const phaseConfig: Record<MissionPhase, {
  startDay: number;
  endDay: number;
  effects: { resting_hr: number; congestion: number; sleep_hours: number };
}> = {
  preflight: { startDay: 0, endDay: 6, effects: { resting_hr: 0, congestion: 0, sleep_hours: 0 } },
  launch_adaptation: { startDay: 7, endDay: 20, effects: { resting_hr: 5, congestion: 3, sleep_hours: -0.5 } },
  mid_mission: { startDay: 21, endDay: 165, effects: { resting_hr: 1, congestion: 1, sleep_hours: -0.2 } },
  return: { startDay: 166, endDay: 180, effects: { resting_hr: 4, congestion: 0, sleep_hours: -0.4 } },
};

export const scenarioEffects = {
  sleep_deprivation: { sleep_hours: -2.7, sleep_efficiency: -18, reaction_time: 0.12 },
  bp_drift: { systolic_bp: 22, diastolic_bp: 14 },
  solar_particle_event: { radiation_spike: 0.45 },
  isolation_mood_decline: { mood: -3 },
  bone_muscle_decline: { exercise_minutes: -24 },
} as const;
