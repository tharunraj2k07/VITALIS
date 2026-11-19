import type { MissionPhase, Observation, ScenarioType } from "./types.js";
import { missionLengthDays, phaseConfig, scenarioEffects } from "./simulator-config.js";

export interface ActiveScenario {
  type: ScenarioType;
  startDay: number;
  durationDays?: number;
}

export interface SimulateOptions {
  crewId?: string;
  seed?: number | string;
  days?: number;
  scenarios?: ActiveScenario[];
}

function hashSeed(seed: number | string, crewId: string): number {
  let hash = 2166136261;
  for (const char of `${seed}:${crewId}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomGenerator(seed: number) {
  let state = seed || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function phaseAt(day: number): MissionPhase {
  if (day <= phaseConfig.preflight.endDay) return "preflight";
  if (day <= phaseConfig.launch_adaptation.endDay) return "launch_adaptation";
  if (day <= phaseConfig.mid_mission.endDay) return "mid_mission";
  return "return";
}

export function simulateMission(options: SimulateOptions = {}): Observation[] {
  const crewId = options.crewId ?? "crew-1";
  const count = Math.max(1, Math.min(options.days ?? missionLengthDays, missionLengthDays));
  const rand = randomGenerator(hashSeed(options.seed ?? 1, crewId));
  const scenarios = options.scenarios ?? [];
  let cumulativeDose = 0;

  return Array.from({ length: count }, (_, day) => {
    const phase = phaseAt(day);
    const phaseEffects = phaseConfig[phase].effects;
    const active = scenarios.filter((scenario) => {
      const duration = scenario.durationDays ?? count;
      return day >= scenario.startDay && day < scenario.startDay + duration;
    });
    const effects = {
      sleep_hours: 0, sleep_efficiency: 0, reaction_time: 0, systolic_bp: 0,
      diastolic_bp: 0, mood: 0, exercise_minutes: 0, radiation_spike: 0,
    };
    for (const scenario of active) {
      const effect = scenarioEffects[scenario.type];
      for (const [key, value] of Object.entries(effect)) {
        effects[key as keyof typeof effects] += value;
      }
    }

    cumulativeDose += 0.018 + rand() * 0.006 + effects.radiation_spike;
    const noise = () => (rand() - 0.5) * 2;
    return {
      crewId,
      day,
      phase,
      metrics: {
        resting_hr: round(61 + phaseEffects.resting_hr + noise() * 2),
        systolic_bp: round(112 + effects.systolic_bp + noise() * 4),
        diastolic_bp: round(72 + effects.diastolic_bp + noise() * 3),
        spo2: round(98 + noise() * 0.7, 1),
        skin_temp: round(36.5 + noise() * 0.25, 1),
        sleep_hours: round(Math.max(0, 7.5 + phaseEffects.sleep_hours + effects.sleep_hours + noise() * 0.35), 1),
        sleep_efficiency: round(Math.max(0, Math.min(100, 88 + effects.sleep_efficiency + noise() * 4)), 1),
        exercise_minutes: round(Math.max(0, 55 + effects.exercise_minutes + noise() * 8)),
        radiation_dose_cumulative: round(cumulativeDose, 3),
        mood: round(Math.max(1, Math.min(10, 7 + effects.mood + noise() * 0.5)), 1),
        congestion: round(Math.max(0, Math.min(10, 1 + phaseEffects.congestion + noise() * 0.7)), 1),
        reaction_time: round(Math.max(0.1, 0.42 + effects.reaction_time + noise() * 0.03), 3),
      },
    };
  });
}

function round(value: number, precision = 0): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}
