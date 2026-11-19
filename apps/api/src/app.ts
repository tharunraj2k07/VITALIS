import express, { type ErrorRequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { matchProtocol } from "@vitalis/core";
import type { MetricName } from "@vitalis/core";
import { activeScenarios, rebuildCrewData } from "./database.js";

const scenarioTypes = ["sleep_deprivation", "bp_drift", "solar_particle_event", "isolation_mood_decline", "bone_muscle_decline"] as const;
const errorCodes = {
  badRequest: "BAD_REQUEST",
  notFound: "NOT_FOUND",
  rateLimited: "RATE_LIMITED",
  internal: "INTERNAL_SERVER_ERROR",
} as const;

export interface ApiConfig {
  corsOrigins?: string[];
  rateLimitWindowMs?: number;
  rateLimitMax?: number;
  logger?: (line: string) => void;
}

function positiveEnvInteger(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function sendError(response: express.Response, status: number, error: string, code: string) {
  return response.status(status).json({ error, code });
}

const checkinSchema = z.object({
  day: z.number().int().min(0).max(179),
  mood: z.number().int().min(1).max(10),
  sleep_quality: z.number().int().min(1).max(5),
  congestion: z.number().int().min(0).max(10),
  headache: z.number().int().min(0).max(10),
  notes: z.string().max(1000).default(""),
});
const idParams = z.object({ id: z.string().min(1).max(100) });
const crewParams = z.object({ id: z.string().min(1).max(100) });
const scenarioSchema = z.object({
  crewId: z.string().min(1).max(100),
  type: z.enum(scenarioTypes),
  startDay: z.number().int().min(0).max(179),
  durationDays: z.number().int().min(1).max(180).default(7),
});

export function createApp(db: DatabaseSync, config: ApiConfig = {}) {
  const app = express();
  app.disable("etag");
  const origins = config.corsOrigins ?? (process.env.CORS_ORIGINS ?? "*").split(",").map((origin) => origin.trim()).filter(Boolean);
  const windowMs = config.rateLimitWindowMs ?? positiveEnvInteger("RATE_LIMIT_WINDOW_MS", 60_000);
  const requestLimit = config.rateLimitMax ?? positiveEnvInteger("RATE_LIMIT_MAX", 120);
  const logger = config.logger ?? ((line: string) => console.log(line));
  const requests = new Map<string, { startedAt: number; count: number }>();
  app.use((request, response, next) => {
    const startedAt = Date.now();
    response.setHeader("Cache-Control", "no-store");
    response.on("finish", () => logger(`${request.method} ${request.path} ${response.statusCode} ${Date.now() - startedAt}ms`));
    next();
  });
  app.use((request, response, next) => {
    const origin = request.get("origin");
    if (origins.includes("*")) response.setHeader("Access-Control-Allow-Origin", "*");
    else if (origin && origins.includes(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.vary("Origin");
    }
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    if (request.method === "OPTIONS") {
      response.sendStatus(204);
      return;
    }
    next();
  });
  app.use((request, response, next) => {
    const now = Date.now();
    const key = request.ip ?? request.socket.remoteAddress ?? "unknown";
    let bucket = requests.get(key);
    if (!bucket || now - bucket.startedAt >= windowMs) {
      bucket = { startedAt: now, count: 0 };
      requests.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > requestLimit) {
      sendError(response, 429, "Too many requests; try again later.", errorCodes.rateLimited);
      return;
    }
    next();
  });
  app.use(express.json({ limit: "64kb" }));

  const crewExists = (id: string) => Boolean(db.prepare("SELECT 1 FROM crew_members WHERE id = ?").get(id));
  const notFound = (response: express.Response, message: string) => sendError(response, 404, message, errorCodes.notFound);

  app.get("/api/health", (_request, response) => response.json({ status: "ok", service: "VITALIS API" }));
  app.get("/api/crew", (_request, response) => {
    response.json(db.prepare("SELECT id, name, role, mission_day AS missionDay FROM crew_members ORDER BY id").all());
  });
  app.post("/api/crew/:id/simulate", (request, response) => {
    const params = crewParams.safeParse(request.params);
      const body = z.object({
        seed: z.number().int().optional(),
        resetScenarios: z.boolean().default(false),
      }).safeParse(request.body ?? {});
    if (!params.success || !body.success) return sendError(response, 400, "Invalid crew ID or simulation body", errorCodes.badRequest);
    if (!crewExists(params.data.id)) return notFound(response, "Crew member not found");
    if (body.data.resetScenarios) {
      db.exec("BEGIN");
      try {
        db.prepare("DELETE FROM scenarios WHERE crew_id = ?").run(params.data.id);
        rebuildCrewData(db, params.data.id, body.data.seed ?? 1, []);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    } else {
      rebuildCrewData(db, params.data.id, body.data.seed ?? 1, activeScenarios(db, params.data.id));
    }
    response.json({ crewId: params.data.id, observations: 180, deterministic: true });
  });
  app.get("/api/crew/:id/observations", (request, response) => {
    const params = crewParams.safeParse(request.params);
    const query = z.object({
      from: z.coerce.number().int().min(0).max(179).default(0),
      to: z.coerce.number().int().min(0).max(179).default(179),
    }).refine((value) => value.from <= value.to).safeParse(request.query);
    if (!params.success || !query.success) return sendError(response, 400, "Invalid crew ID or day range", errorCodes.badRequest);
    if (!crewExists(params.data.id)) return notFound(response, "Crew member not found");
    const rows = db.prepare("SELECT day, phase, metric, value FROM observations WHERE crew_id = ? AND day BETWEEN ? AND ? ORDER BY day, metric")
      .all(params.data.id, query.data.from, query.data.to) as { day: number; phase: string; metric: string; value: number }[];
    const days = new Map<number, { crewId: string; day: number; phase: string; metrics: Record<string, number> }>();
    for (const row of rows) {
      const current = days.get(row.day) ?? { crewId: params.data.id, day: row.day, phase: row.phase, metrics: {} };
      current.metrics[row.metric] = row.value;
      days.set(row.day, current);
    }
    response.json([...days.values()]);
  });
  app.get("/api/crew/:id/baseline", (request, response) => {
    const params = crewParams.safeParse(request.params);
    if (!params.success) return sendError(response, 400, "Invalid crew ID", errorCodes.badRequest);
    if (!crewExists(params.data.id)) return notFound(response, "Crew member not found");
    response.json(db.prepare("SELECT metric, mean, std, sample_count AS sampleCount FROM baselines WHERE crew_id = ? ORDER BY metric").all(params.data.id));
  });
  app.get("/api/crew/:id/scores", (request, response) => {
    const params = crewParams.safeParse(request.params);
    const query = z.object({ day: z.coerce.number().int().min(0).max(179).optional() }).safeParse(request.query);
    if (!params.success || !query.success) return sendError(response, 400, "Invalid crew ID or day", errorCodes.badRequest);
    if (!crewExists(params.data.id)) return notFound(response, "Crew member not found");
    const day = query.data.day ?? 179;
    response.json(db.prepare("SELECT domain, score, explanation, day FROM domain_scores WHERE crew_id = ? AND day = ? ORDER BY domain").all(params.data.id, day));
  });
  app.get("/api/crew/:id/alerts", (request, response) => {
    const params = crewParams.safeParse(request.params);
    const query = z.object({ status: z.enum(["open", "acknowledged", "resolved"]).optional() }).safeParse(request.query);
    if (!params.success || !query.success) return sendError(response, 400, "Invalid crew ID or alert filter", errorCodes.badRequest);
    if (!crewExists(params.data.id)) return notFound(response, "Crew member not found");
    const alerts = query.data.status
      ? db.prepare("SELECT * FROM alerts WHERE crew_id = ? AND status = ? ORDER BY CASE severity WHEN 'red' THEN 0 ELSE 1 END, day DESC").all(params.data.id, query.data.status)
      : db.prepare("SELECT * FROM alerts WHERE crew_id = ? ORDER BY CASE severity WHEN 'red' THEN 0 ELSE 1 END, day DESC").all(params.data.id);
    response.json((alerts as { metric: string; related_metrics?: string }[]).map((alert) => {
      const relatedMetrics = alert.related_metrics ? JSON.parse(alert.related_metrics) as string[] : [];
      return { ...alert, relatedMetrics: relatedMetrics.length ? relatedMetrics : [alert.metric] };
    }));
  });
  app.patch("/api/alerts/:id", (request, response) => {
    const params = idParams.safeParse(request.params);
    const body = z.object({ status: z.enum(["open", "acknowledged", "resolved"]) }).safeParse(request.body);
    if (!params.success || !body.success) return sendError(response, 400, "Invalid alert ID or status", errorCodes.badRequest);
    const result = db.prepare("UPDATE alerts SET status = ? WHERE id = ?").run(body.data.status, params.data.id);
    if (!result.changes) return notFound(response, "Alert not found");
    response.json(db.prepare("SELECT * FROM alerts WHERE id = ?").get(params.data.id));
  });
  app.get("/api/alerts/:id/protocol", (request, response) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return sendError(response, 400, "Invalid alert ID", errorCodes.badRequest);
    const alert = db.prepare("SELECT * FROM alerts WHERE id = ?").get(params.data.id) as {
      id: string; crew_id: string; day: number; metric: string; severity: "amber" | "red"; status: "open" | "acknowledged" | "resolved";
      value: number; baseline_mean: number; baseline_std: number; z_score: number; explanation: string; related_metrics: string;
    } | undefined;
    if (!alert) return notFound(response, "Alert not found");
    const records = db.prepare("SELECT data_json FROM protocols").all() as { data_json: string }[];
    const protocols = records.map((record) => JSON.parse(record.data_json));
    const protocol = matchProtocol({
      id: alert.id, crewId: alert.crew_id, day: alert.day, metric: alert.metric as MetricName,
      severity: alert.severity, status: alert.status, value: alert.value, baselineMean: alert.baseline_mean,
      baselineStd: alert.baseline_std, zScore: alert.z_score, explanation: alert.explanation,
      relatedMetrics: JSON.parse(alert.related_metrics).length
        ? JSON.parse(alert.related_metrics)
        : [alert.metric],
    }, protocols);
    if (!protocol) return notFound(response, "No response protocol matches this alert");
    response.json(protocol);
  });
  app.post("/api/alerts/:id/actions", (request, response) => {
    const params = idParams.safeParse(request.params);
    const body = z.object({ action: z.string().trim().min(1).max(300) }).safeParse(request.body);
    if (!params.success || !body.success) return sendError(response, 400, "Invalid alert ID or action", errorCodes.badRequest);
    if (!db.prepare("SELECT 1 FROM alerts WHERE id = ?").get(params.data.id)) return notFound(response, "Alert not found");
    const id = randomUUID();
    db.prepare("INSERT INTO alert_actions (id, alert_id, action, created_at) VALUES (?, ?, ?, ?)")
      .run(id, params.data.id, body.data.action, new Date().toISOString());
    response.status(201).json({ id, alertId: params.data.id, action: body.data.action });
  });
  app.post("/api/crew/:id/checkins", (request, response) => {
    const params = crewParams.safeParse(request.params);
    const body = checkinSchema.safeParse(request.body);
    if (!params.success || !body.success) return sendError(response, 400, "Invalid check-in data", errorCodes.badRequest);
    if (!crewExists(params.data.id)) return notFound(response, "Crew member not found");
    const id = randomUUID();
    const checkin = body.data;
    db.prepare("INSERT INTO checkins (id, crew_id, day, mood, sleep_quality, congestion, headache, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, params.data.id, checkin.day, checkin.mood, checkin.sleep_quality, checkin.congestion, checkin.headache, checkin.notes, new Date().toISOString());
    response.status(201).json({ id, crewId: params.data.id, ...checkin });
  });
  app.post("/api/scenarios", (request, response) => {
    const body = scenarioSchema.safeParse(request.body);
    if (!body.success) return sendError(response, 400, "Invalid scenario", errorCodes.badRequest);
    if (!crewExists(body.data.crewId)) return notFound(response, "Crew member not found");
    const id = randomUUID();
    db.prepare("INSERT INTO scenarios (id, crew_id, type, start_day, duration_days, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, body.data.crewId, body.data.type, body.data.startDay, body.data.durationDays, new Date().toISOString());
    rebuildCrewData(db, body.data.crewId, 100, activeScenarios(db, body.data.crewId));
    response.status(201).json({ id, ...body.data });
  });
  app.delete("/api/scenarios/:id", (request, response) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return sendError(response, 400, "Invalid scenario ID", errorCodes.badRequest);
    const scenario = db.prepare("SELECT crew_id FROM scenarios WHERE id = ?").get(params.data.id) as { crew_id: string } | undefined;
    if (!scenario) return notFound(response, "Scenario not found");
    db.prepare("DELETE FROM scenarios WHERE id = ?").run(params.data.id);
    rebuildCrewData(db, scenario.crew_id, 100, activeScenarios(db, scenario.crew_id));
    response.status(204).end();
  });
  app.get("/api/protocols", (_request, response) => {
    const records = db.prepare("SELECT data_json FROM protocols").all() as { data_json: string }[];
    response.json(records.map((record) => JSON.parse(record.data_json)));
  });
  app.post("/api/sync", (request, response) => {
    const body = z.object({ items: z.array(z.object({
      id: z.string().min(1).max(100), kind: z.enum(["checkin", "alert_action", "scenario"]), payload: z.record(z.unknown()),
    })).max(100) }).safeParse(request.body);
    if (!body.success) return sendError(response, 400, "Invalid sync payload", errorCodes.badRequest);
    const outcomes: { id: string; status: string }[] = [];
    for (const item of body.data.items) {
      const previous = db.prepare("SELECT status FROM sync_queue WHERE id = ?").get(item.id) as { status: string } | undefined;
      if (previous?.status === "processed") {
        outcomes.push({ id: item.id, status: "already_processed" });
        continue;
      }
      try {
        db.exec("BEGIN");
        db.prepare("INSERT OR REPLACE INTO sync_queue (id, kind, payload_json, status, created_at) VALUES (?, ?, ?, 'pending', ?)")
          .run(item.id, item.kind, JSON.stringify(item.payload), new Date().toISOString());
        if (item.kind === "checkin") {
          const parsed = checkinSchema.parse(item.payload);
          const crewId = z.string().min(1).parse(item.payload.crewId);
          if (!crewExists(crewId)) throw new Error("Crew member not found");
          db.prepare("INSERT OR IGNORE INTO checkins (id, crew_id, day, mood, sleep_quality, congestion, headache, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run(item.id, crewId, parsed.day, parsed.mood, parsed.sleep_quality, parsed.congestion, parsed.headache, parsed.notes, new Date().toISOString());
        } else if (item.kind === "alert_action") {
          const parsed = z.object({ alertId: z.string().min(1), action: z.string().trim().min(1).max(300) }).parse(item.payload);
          if (!db.prepare("SELECT 1 FROM alerts WHERE id = ?").get(parsed.alertId)) throw new Error("Alert not found");
          db.prepare("INSERT OR IGNORE INTO alert_actions (id, alert_id, action, created_at) VALUES (?, ?, ?, ?)")
            .run(item.id, parsed.alertId, parsed.action, new Date().toISOString());
        } else {
          const parsed = scenarioSchema.parse(item.payload);
          if (!crewExists(parsed.crewId)) throw new Error("Crew member not found");
          db.prepare("INSERT OR IGNORE INTO scenarios (id, crew_id, type, start_day, duration_days, created_at) VALUES (?, ?, ?, ?, ?, ?)")
            .run(item.id, parsed.crewId, parsed.type, parsed.startDay, parsed.durationDays, new Date().toISOString());
          rebuildCrewData(db, parsed.crewId, 100, activeScenarios(db, parsed.crewId));
        }
        db.prepare("UPDATE sync_queue SET status = 'processed' WHERE id = ?").run(item.id);
        db.exec("COMMIT");
        outcomes.push({ id: item.id, status: "processed" });
      } catch (error) {
        db.exec("ROLLBACK");
        if (error instanceof z.ZodError) return sendError(response, 400, "Invalid queued item", errorCodes.badRequest);
        if (error instanceof Error && error.message === "Crew member not found") return notFound(response, error.message);
        if (error instanceof Error && error.message === "Alert not found") return notFound(response, error.message);
        throw error;
      }
    }
    response.json({ outcomes });
  });

  app.use((_request, response) => sendError(response, 404, "Route not found", errorCodes.notFound));
  app.use(((error: unknown, _request, response, _next) => {
    const status = typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status: unknown }).status)
      : 500;
    if (status >= 400 && status < 500) {
      const code = status === 413 ? "PAYLOAD_TOO_LARGE" : errorCodes.badRequest;
      sendError(response, status, status === 413 ? "Request body is too large" : "Invalid request body", code);
      return;
    }
    console.error("Unhandled API error:", error);
    sendError(response, 500, "Internal server error", errorCodes.internal);
  }) as ErrorRequestHandler);
  return app;
}
