import Dexie, { type Table } from "dexie";
import { z } from "zod";
import {
  calculateBaselines, calculateDomainScores, detectAlerts, matchProtocol, simulateMission,
} from "@vitalis/core";
import type {
  ActiveScenario, DomainScore, HealthAlert, Observation, Protocol, ScenarioType, MetricName,
} from "@vitalis/core";
import protocolData from "../../../data/protocols.json";

export type LocalCrew = { id: string; name: string; role: string; missionDay: number };
export type QueuedWrite = {
  id: string;
  kind: "checkin" | "alert_action" | "scenario";
  payload: Record<string, unknown>;
  status: "pending" | "processed";
  createdAt: string;
};
type SyncItem = Pick<QueuedWrite, "id" | "kind" | "payload">;
const syncResponseSchema = z.object({
  outcomes: z.array(z.object({
    id: z.string(),
    status: z.enum(["processed", "already_processed"]),
  })).max(100),
});
export type LocalBaseline = { crewId: string; metric: MetricName; mean: number; std: number; sampleCount: number };
export type LocalScore = DomainScore & { crewId: string; day: number };
export type LocalProtocol = Protocol;
export type OfflineCheckin = {
  id: string;
  crewId: string;
  day: number;
  mood: number;
  sleep_quality: number;
  congestion: number;
  headache: number;
  notes: string;
  createdAt: string;
};
export type LocalScenario = ActiveScenario & { id: string; crewId: string; createdAt: string };

export const fallbackCrew: LocalCrew[] = [
  { id: "crew-1", name: "Commander Alex Rivera", role: "Commander", missionDay: 179 },
  { id: "crew-2", name: "Dr. Sam Okafor", role: "Flight Surgeon", missionDay: 179 },
  { id: "crew-3", name: "Pilot Morgan Chen", role: "Pilot", missionDay: 179 },
  { id: "crew-4", name: "Specialist Taylor Singh", role: "Mission Specialist", missionDay: 179 },
];

export class VitalisDatabase extends Dexie {
  crews!: Table<LocalCrew, string>;
  observations!: Table<Observation, [string, number]>;
  baselines!: Table<LocalBaseline, [string, string]>;
  scores!: Table<LocalScore, [string, number, string]>;
  alerts!: Table<HealthAlert, string>;
  protocols!: Table<Protocol, string>;
  queuedWrites!: Table<QueuedWrite, string>;
  checkins!: Table<OfflineCheckin, string>;
  scenarios!: Table<LocalScenario, string>;
  syncMeta!: Table<{ id: string; value: string }, string>;

  constructor() {
    super("vitalis-offline");
    this.version(2).stores({
      crews: "id",
      observations: "[crewId+day], crewId, day",
      baselines: "[crewId+metric], crewId",
      scores: "[crewId+day+domain], crewId, day",
      alerts: "id, crewId, day, status",
      protocols: "id",
      queuedWrites: "id, status, createdAt",
      checkins: "id, crewId, day",
      scenarios: "id, crewId, type",
    });
    this.version(3).stores({
      crews: "id",
      observations: "[crewId+day], crewId, day",
      baselines: "[crewId+metric], crewId",
      scores: "[crewId+day+domain], crewId, day",
      alerts: "id, crewId, day, status",
      protocols: "id",
      queuedWrites: "id, status, createdAt",
      checkins: "id, crewId, day",
      scenarios: "id, crewId, type",
      syncMeta: "id",
    });
  }
}

export const offlineDb = new VitalisDatabase();

export function deterministicSeed(crewId: string): number {
  const index = fallbackCrew.findIndex((crew) => crew.id === crewId);
  return 100 + Math.max(0, index);
}

export function buildLocalMission(
  crewId: string,
  seed = deterministicSeed(crewId),
  scenarios: ActiveScenario[] = [],
) {
  const observations = simulateMission({ crewId, seed, days: 180, scenarios });
  const baselines = calculateBaselines(observations);
  const alerts = detectAlerts(observations, baselines);
  const scores = observations.flatMap((observation) =>
    calculateDomainScores(observation, baselines).map((score) => ({ ...score, crewId, day: observation.day })));
  return { observations, baselines, alerts, scores, protocols: protocolData as Protocol[] };
}

async function ensureLocalCrew(crew: LocalCrew): Promise<void> {
  await offlineDb.crews.put(crew);
  const hasData = await offlineDb.observations.where("crewId").equals(crew.id).first();
  const scenarios = await offlineDb.scenarios.where("crewId").equals(crew.id).toArray();
  if (hasData && scenarios.length === 0) return;
  const mission = buildLocalMission(crew.id, deterministicSeed(crew.id), scenarios);
  await offlineDb.transaction("rw", offlineDb.observations, offlineDb.baselines, offlineDb.alerts, offlineDb.scores, offlineDb.protocols, async () => {
    await offlineDb.observations.where("crewId").equals(crew.id).delete();
    await offlineDb.baselines.where("crewId").equals(crew.id).delete();
    await offlineDb.alerts.where("crewId").equals(crew.id).delete();
    await offlineDb.scores.where("crewId").equals(crew.id).delete();
    await offlineDb.observations.bulkPut(mission.observations);
    await offlineDb.baselines.bulkPut(mission.baselines.map((item) => ({ ...item, crewId: crew.id })));
    await offlineDb.alerts.bulkPut(mission.alerts);
    await offlineDb.scores.bulkPut(mission.scores);
    await offlineDb.protocols.bulkPut(mission.protocols);
  });
}

export async function listLocalCrew(): Promise<LocalCrew[]> {
  await offlineDb.crews.bulkPut(fallbackCrew);
  return offlineDb.crews.toArray();
}

export async function loadLocalSnapshot(crewId: string, name?: string, day = 179) {
  const crew = fallbackCrew.find((member) => member.id === crewId) ?? {
    id: crewId, name: name ?? crewId, role: "Crew member", missionDay: 179,
  };
  await ensureLocalCrew(crew);
  const [observations, baselines, alerts, scores, protocols] = await Promise.all([
    offlineDb.observations.where("crewId").equals(crewId).and((row) => row.day <= day).toArray(),
    offlineDb.baselines.where("crewId").equals(crewId).toArray(),
    offlineDb.alerts.where("crewId").equals(crewId).toArray(),
    offlineDb.scores.where("[crewId+day]").equals([crewId, day]).toArray(),
    offlineDb.protocols.toArray(),
  ]);
  return { observations, baselines, alerts, scores, protocols, crew };
}

export async function cacheRemoteSnapshot(
  crew: LocalCrew,
  observations: Observation[],
  baselines: Omit<LocalBaseline, "crewId">[],
  alerts: HealthAlert[],
  scores: Omit<LocalScore, "crewId">[],
  protocols: Protocol[],
): Promise<void> {
  await offlineDb.transaction("rw", offlineDb.crews, offlineDb.observations, offlineDb.baselines, offlineDb.alerts, offlineDb.scores, async () => {
    await offlineDb.crews.put(crew);
    await offlineDb.observations.bulkPut(observations);
    await offlineDb.baselines.bulkPut(baselines.map((item) => ({ ...item, crewId: crew.id })));
    await offlineDb.alerts.bulkPut(alerts);
    await offlineDb.scores.bulkPut(scores.map((item) => ({ ...item, crewId: crew.id })));
  });
  await offlineDb.protocols.bulkPut(protocols);
}

export async function enqueueWrite(
  kind: QueuedWrite["kind"],
  payload: Record<string, unknown>,
): Promise<QueuedWrite> {
  const item: QueuedWrite = {
    id: crypto.randomUUID(), kind, payload, status: "pending", createdAt: new Date().toISOString(),
  };
  await offlineDb.queuedWrites.add(item);
  return item;
}

export async function saveCheckin(crewId: string, payload: Omit<OfflineCheckin, "id" | "crewId" | "createdAt">) {
  await offlineDb.checkins.add({
    id: crypto.randomUUID(), crewId, ...payload, createdAt: new Date().toISOString(),
  });
}

export async function markLocalAlert(alertId: string, status: HealthAlert["status"]) {
  await offlineDb.alerts.update(alertId, { status });
}

export async function runLocalScenario(
  crewId: string,
  type: ScenarioType,
  startDay: number,
  durationDays: number,
): Promise<void> {
  const scenario: LocalScenario = {
    id: crypto.randomUUID(), crewId, type, startDay, durationDays, createdAt: new Date().toISOString(),
  };
  await offlineDb.scenarios.add(scenario);
  await offlineDb.observations.where("crewId").equals(crewId).delete();
  const crew = fallbackCrew.find((member) => member.id === crewId);
  await ensureLocalCrew(crew ?? { id: crewId, name: crewId, role: "Crew member", missionDay: 179 });
}

export async function resetLocalDemo(crewId: string): Promise<void> {
  await offlineDb.transaction("rw", [
    offlineDb.queuedWrites,
    offlineDb.checkins,
    offlineDb.scenarios,
    offlineDb.observations,
    offlineDb.baselines,
    offlineDb.alerts,
    offlineDb.scores,
  ], async () => {
      const queued = await offlineDb.queuedWrites.where("status").equals("pending").toArray();
      await offlineDb.queuedWrites.bulkDelete(queued
        .filter((item) => (item.kind === "scenario" && item.payload.crewId === crewId)
          || (item.kind === "checkin" && item.payload.crewId === crewId
            && item.payload.notes === "Deterministic demo offline check-in."))
        .map((item) => item.id));
      const demoCheckins = await offlineDb.checkins.where("crewId").equals(crewId).toArray();
      await offlineDb.checkins.bulkDelete(demoCheckins
        .filter((item) => item.notes === "Deterministic demo offline check-in.")
        .map((item) => item.id));
      await offlineDb.scenarios.where("crewId").equals(crewId).delete();
      await offlineDb.observations.where("crewId").equals(crewId).delete();
      await offlineDb.baselines.where("crewId").equals(crewId).delete();
      await offlineDb.alerts.where("crewId").equals(crewId).delete();
      await offlineDb.scores.where("crewId").equals(crewId).delete();
  });
  const crew = fallbackCrew.find((member) => member.id === crewId)
    ?? { id: crewId, name: crewId, role: "Crew member", missionDay: 179 };
  await ensureLocalCrew(crew);
}

export async function queuedWriteCount(): Promise<number> {
  return offlineDb.queuedWrites.where("status").equals("pending").count();
}

export async function lastSyncTime(): Promise<string | null> {
  return (await offlineDb.syncMeta.get("lastSync"))?.value ?? null;
}

export async function deliverQueuedWrites(
  pending: SyncItem[],
  send: (items: SyncItem[]) => Promise<unknown>,
  markProcessed: (ids: string[]) => Promise<void>,
): Promise<void> {
  if (pending.length === 0) return;
  const { outcomes } = syncResponseSchema.parse(await send(pending));
  const confirmed = new Set(outcomes.map((outcome) => outcome.id));
  if (confirmed.size !== outcomes.length || outcomes.length !== pending.length
    || pending.some((item) => !confirmed.has(item.id))) {
    throw new Error("Sync response did not confirm every queued write.");
  }
  await markProcessed([...confirmed]);
}

export async function flushQueuedWrites(): Promise<void> {
  const pending = await offlineDb.queuedWrites.where("status").equals("pending").toArray();
  if (pending.length === 0) return;
  const apiBase = import.meta.env.VITE_API_URL ?? "";
  await deliverQueuedWrites(pending, async (items) => {
    const response = await fetch(`${apiBase}/api/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    if (!response.ok) throw new Error(`Sync failed (${response.status})`);
    return response.json() as Promise<unknown>;
  }, async (ids) => {
    await offlineDb.transaction("rw", offlineDb.queuedWrites, async () => {
      for (const id of ids) await offlineDb.queuedWrites.update(id, { status: "processed" });
    });
  });
  await offlineDb.syncMeta.put({ id: "lastSync", value: new Date().toISOString() });
}

export function findLocalProtocol(alert: HealthAlert, protocols: Protocol[]) {
  return matchProtocol(alert, protocols);
}

export function getScoreAt(scores: LocalScore[], crewId: string, day: number) {
  return scores.filter((score) => score.crewId === crewId && score.day === day);
}

export type OfflineScenario = { type: ScenarioType; startDay: number; durationDays: number };
