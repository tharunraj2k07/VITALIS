import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { calculateBaselines, calculateDomainScores, detectAlerts, metricNames, simulateMission } from "@vitalis/core";
import type { ActiveScenario } from "@vitalis/core";
import type { Protocol, ScenarioType } from "@vitalis/core";

const protocolSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  domain: z.enum(["cardiovascular", "sleep_immune", "musculoskeletal", "radiation", "behavioral_cognitive"]),
  title: z.string().min(1),
  tier: z.enum(["self_manage", "monitor", "escalate"]),
  trigger: z.object({
    any_metric: z.array(z.enum(metricNames)).optional(),
    min_severity: z.enum(["amber", "red"]).optional(),
  }).strict(),
  non_drug_steps: z.array(z.string().min(1)).min(1),
  medication_category: z.object({ class: z.string().min(1), note: z.string().min(1) }).strict().nullable(),
  escalate_if: z.array(z.string().min(1)).min(1),
  sources: z.array(z.object({ title: z.string().min(1), url: z.string().min(1) }).strict()).min(1),
  verified: z.boolean(),
  disclaimer: z.literal("Decision support only, not medical advice."),
}).strict();
const protocolListSchema = z.array(protocolSchema).min(1);

function readSchema(): string {
  for (const path of [resolve(process.cwd(), "src/schema.sql"), resolve(process.cwd(), "apps/api/src/schema.sql")]) {
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error("Unable to locate the SQLite schema");
}
const crewSeed = [
  { id: "crew-1", name: "Commander Alex Rivera", role: "Commander" },
  { id: "crew-2", name: "Dr. Sam Okafor", role: "Flight Surgeon" },
  { id: "crew-3", name: "Pilot Morgan Chen", role: "Pilot" },
  { id: "crew-4", name: "Specialist Taylor Singh", role: "Mission Specialist" },
];

export function loadProtocols(): Protocol[] {
  const paths = [resolve(process.cwd(), "data/protocols.json"), resolve(process.cwd(), "../../data/protocols.json")];
  for (const path of paths) {
    try {
      return protocolListSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error("Unable to locate data/protocols.json");
}

export function createDatabase(path = ":memory:", protocols: Protocol[] = loadProtocols()): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(readSchema());
  const alertColumns = db.prepare("PRAGMA table_info(alerts)").all() as { name: string }[];
  if (!alertColumns.some((column) => column.name === "related_metrics")) {
    db.exec("ALTER TABLE alerts ADD COLUMN related_metrics TEXT NOT NULL DEFAULT '[]'");
  }
  seedDatabase(db, protocols);
  return db;
}

export function seedDatabase(db: DatabaseSync, protocols: Protocol[]): void {
  const validatedProtocols = protocolListSchema.parse(protocols);
  const existing = db.prepare("SELECT COUNT(*) AS count FROM crew_members").get() as { count: number };
  if (existing.count > 0) return;
  const insertCrew = db.prepare("INSERT INTO crew_members (id, name, role, mission_day) VALUES (?, ?, ?, 179)");
  const insertProtocol = db.prepare("INSERT INTO protocols (id, data_json) VALUES (?, ?)");
  const insertSource = db.prepare("INSERT INTO protocol_sources (protocol_id, title, url) VALUES (?, ?, ?)");
  db.exec("BEGIN");
  try {
    for (const crew of crewSeed) insertCrew.run(crew.id, crew.name, crew.role);
    for (const protocol of validatedProtocols) {
      insertProtocol.run(protocol.id, JSON.stringify(protocol));
      for (const source of protocol.sources) insertSource.run(protocol.id, source.title, source.url);
    }
    for (let index = 0; index < crewSeed.length; index += 1) {
      rebuildCrewData(db, crewSeed[index].id, index + 100);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function rebuildCrewData(db: DatabaseSync, crewId: string, seed: number, scenarios?: ActiveScenario[]): void {
  const observationInsert = db.prepare("INSERT INTO observations (crew_id, day, phase, metric, value) VALUES (?, ?, ?, ?, ?)");
  const baselineInsert = db.prepare("INSERT INTO baselines (crew_id, metric, mean, std, sample_count) VALUES (?, ?, ?, ?, ?)");
  const scoreInsert = db.prepare("INSERT INTO domain_scores (crew_id, day, domain, score, explanation) VALUES (?, ?, ?, ?, ?)");
  const alertInsert = db.prepare("INSERT INTO alerts (id, crew_id, day, metric, severity, status, value, baseline_mean, baseline_std, z_score, explanation, related_metrics) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const observations = simulateMission({ crewId, seed, days: 180, scenarios });
  const baselines = calculateBaselines(observations);
  db.prepare("DELETE FROM observations WHERE crew_id = ?").run(crewId);
  db.prepare("DELETE FROM baselines WHERE crew_id = ?").run(crewId);
  db.prepare("DELETE FROM domain_scores WHERE crew_id = ?").run(crewId);
  db.prepare("DELETE FROM alert_actions WHERE alert_id IN (SELECT id FROM alerts WHERE crew_id = ?)").run(crewId);
  db.prepare("DELETE FROM alerts WHERE crew_id = ?").run(crewId);
  for (const row of observations) {
    for (const [metric, value] of Object.entries(row.metrics)) observationInsert.run(crewId, row.day, row.phase, metric, value);
    for (const score of calculateDomainScores(row, baselines)) scoreInsert.run(crewId, row.day, score.domain, score.score, score.explanation);
  }
  for (const baseline of baselines) baselineInsert.run(crewId, baseline.metric, baseline.mean, baseline.std, baseline.sampleCount);
  for (const alert of detectAlerts(observations, baselines)) {
    alertInsert.run(alert.id, crewId, alert.day, alert.metric, alert.severity, alert.status, alert.value,
      alert.baselineMean, alert.baselineStd, alert.zScore, alert.explanation, JSON.stringify(alert.relatedMetrics ?? [alert.metric]));
  }
}

export function activeScenarios(db: DatabaseSync, crewId: string): ActiveScenario[] {
  return (db.prepare("SELECT type, start_day AS startDay, duration_days AS durationDays FROM scenarios WHERE crew_id = ?")
    .all(crewId) as { type: ScenarioType; startDay: number; durationDays: number }[]);
}
