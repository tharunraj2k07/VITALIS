import request from "supertest";
import { createApp } from "./app.js";
import { createDatabase, loadProtocols, seedDatabase } from "./database.js";

describe("VITALIS API", () => {
  const db = createDatabase(":memory:");
  const app = createApp(db, { logger: () => undefined });

  afterAll(() => db.close());

  it("reports health and seeds four crew members", async () => {
    await request(app).get("/api/health").expect(200).expect(({ body }) => {
      expect(body.status).toBe("ok");
    }).expect("Cache-Control", "no-store").expect(({ headers }) => {
      expect(headers.etag).toBeUndefined();
    });

    await request(app).get("/api/crew").expect(200).expect(({ body }) => {
      expect(body).toHaveLength(4);
    });
  });

  it("keeps deterministic seed-on-boot idempotent", () => {
    const seededDb = createDatabase(":memory:");
    const tableCounts = () => ["crew_members", "observations", "baselines", "domain_scores", "alerts", "protocols"]
      .map((table) => (seededDb.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
    const before = tableCounts();
    seedDatabase(seededDb, loadProtocols());
    expect(tableCounts()).toEqual(before);
    seededDb.close();
  });

  it("returns 404 for an unknown crew member and 400 for invalid check-ins", async () => {
    await request(app).get("/api/crew/missing/baseline").expect(404);
    await request(app).post("/api/crew/crew-1/checkins").send({ mood: 30 }).expect(400);
    await request(app).post("/api/crew/crew-1/checkins").send({
      day: 180, mood: 7, sleep_quality: 4, congestion: 1, headache: 0,
    }).expect(400).expect(({ body }) => expect(body.code).toBe("BAD_REQUEST"));
  });

  it("records validated check-ins and resolves an alert protocol", async () => {
    await request(app).post("/api/crew/crew-1/checkins")
      .send({ day: 30, mood: 7, sleep_quality: 4, congestion: 1, headache: 0 })
      .expect(201);
    const alerts = await request(app).get("/api/crew/crew-1/alerts").expect(200);
    expect(alerts.body.length).toBeGreaterThan(0);
    const protocol = await request(app).get(`/api/alerts/${alerts.body[0].id}/protocol`).expect(200);
    expect(protocol.body.disclaimer).toBe("Decision support only, not medical advice.");
    if (protocol.body.tier === "escalate") expect(protocol.body.medication_category).toBeNull();
  });

  it("accepts a deterministic simulation request and rejects invalid scenarios", async () => {
    await request(app).post("/api/crew/crew-1/simulate").send({ seed: 42 }).expect(200);
    await request(app).post("/api/scenarios").send({
      crewId: "crew-1", type: "unknown", startDay: 4, durationDays: 2,
    }).expect(400);
    await request(app).post("/api/scenarios").send({
      crewId: "crew-1", type: "sleep_deprivation", startDay: 25, durationDays: 2,
    }).expect(201);
    await request(app).post("/api/crew/crew-1/simulate")
      .send({ seed: 100, resetScenarios: true }).expect(200);
    expect(db.prepare("SELECT COUNT(*) AS count FROM scenarios WHERE crew_id = ?").get("crew-1"))
      .toEqual({ count: 0 });
  });

  it("processes and deduplicates offline scenario writes", async () => {
    const before = await request(app).get("/api/crew/crew-1/observations?from=14&to=14").expect(200);
    const item = {
      id: "offline-scenario-test",
      kind: "scenario",
      payload: { crewId: "crew-1", type: "sleep_deprivation", startDay: 14, durationDays: 2 },
    };
    await request(app).post("/api/sync").send({ items: [item] }).expect(200).expect(({ body }) => {
      expect(body.outcomes[0].status).toBe("processed");
    });
    const after = await request(app).get("/api/crew/crew-1/observations?from=14&to=14").expect(200);
    expect(after.body[0].metrics.sleep_hours).toBeLessThan(before.body[0].metrics.sleep_hours);
    await request(app).post("/api/sync").send({ items: [item] }).expect(200).expect(({ body }) => {
      expect(body.outcomes[0].status).toBe("already_processed");
    });
  });

  it("covers input validation and success responses across remaining endpoints", async () => {
    const alertResponse = await request(app).get("/api/crew/crew-1/alerts").expect(200);
    const alertId = alertResponse.body[0].id as string;
    expect(await request(app).get("/api/crew/crew-1/observations?from=9&to=2").expect(400).then(({ body }) => body.code))
      .toBe("BAD_REQUEST");
    await request(app).get("/api/crew/crew-1/scores?day=181").expect(400);
    await request(app).get("/api/crew/crew-1/scores?day=180").expect(400);
    await request(app).get("/api/crew/crew-1/observations?to=180").expect(400);
    await request(app).get("/api/crew/crew-1/alerts?status=unknown").expect(400);
    await request(app).post("/api/crew/crew-1/simulate").send({ seed: "not-a-number" }).expect(400);
    await request(app).get(`/api/crew/${"x".repeat(101)}/baseline`).expect(400);
    await request(app).post(`/api/alerts/${alertId}/actions`).send({ action: "Recorded locally" }).expect(201);
    await request(app).patch(`/api/alerts/${alertId}`).send({ status: "acknowledged" }).expect(200);
    await request(app).patch(`/api/alerts/${alertId}`).send({ status: "unknown" }).expect(400);
    await request(app).patch("/api/alerts/missing").send({ status: "resolved" }).expect(404);
    await request(app).get("/api/alerts/missing/protocol").expect(404);
    await request(app).get("/api/alerts/invalid/protocol").expect(404);
    await request(app).post("/api/alerts/missing/actions").send({ action: "check" }).expect(404);
    await request(app).post("/api/alerts/missing/actions").send({ action: "" }).expect(400);
    await request(app).post("/api/crew/crew-1/checkins").send({
      day: 2, mood: 5, sleep_quality: 3, congestion: 1, headache: 0, notes: "ok",
    }).expect(201);
    await request(app).get("/api/protocols").expect(200);
    const { body: scenario } = await request(app).post("/api/scenarios").send({
      crewId: "crew-1", type: "sleep_deprivation", startDay: 30, durationDays: 2,
    }).expect(201);
    await request(app).delete(`/api/scenarios/${scenario.id}`).expect(204);
    await request(app).delete("/api/scenarios/missing").expect(404);
    await request(app).delete(`/api/scenarios/${"x".repeat(101)}`).expect(400);
    await request(app).post("/api/sync").send({ items: "not-an-array" }).expect(400);
    await request(app).get("/no-such-route").expect(404).expect(({ body }) => {
      expect(body).toEqual({ error: "Route not found", code: "NOT_FOUND" });
    });
  });

  it("uses configured CORS, rate limits, request logging, and consistent production-safe errors", async () => {
    const log: string[] = [];
    const configuredApp = createApp(db, {
      corsOrigins: ["https://vitalis.example"],
      rateLimitWindowMs: 60_000,
      rateLimitMax: 1,
      logger: (line) => log.push(line),
    });
    await request(configuredApp).get("/api/health").set("Origin", "https://vitalis.example").expect(200)
      .expect("Access-Control-Allow-Origin", "https://vitalis.example");
    await request(configuredApp).get("/api/health").set("Origin", "https://other.example").expect(429)
      .expect(({ body }) => expect(body).toEqual({
        error: "Too many requests; try again later.", code: "RATE_LIMITED",
      }));
    expect(log).toHaveLength(2);
    expect(log[0]).toContain("GET /api/health 200");

    const closedDb = createDatabase(":memory:");
    const brokenApp = createApp(closedDb, { logger: () => undefined });
    closedDb.close();
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await request(brokenApp).get("/api/crew").expect(500).expect(({ body }) => {
      expect(body).toEqual({ error: "Internal server error", code: "INTERNAL_SERVER_ERROR" });
      expect(body.stack).toBeUndefined();
    });
    consoleError.mockRestore();
  });
});
