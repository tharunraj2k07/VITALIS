import { describe, expect, it } from "vitest";
import { buildLocalMission, deliverQueuedWrites, findLocalProtocol } from "./offline-db";

describe("offline core mission", () => {
  it("recreates deterministic local observations, scores, and alerts", () => {
    const first = buildLocalMission("crew-1");
    const second = buildLocalMission("crew-1");
    expect(first.observations).toHaveLength(180);
    expect(first.observations).toEqual(second.observations);
    expect(first.scores).toHaveLength(900);
  });

  it("only removes queued writes after every item is confirmed, including idempotent retries", async () => {
    const queued = [
      { id: "checkin-1", kind: "checkin" as const, payload: { day: 2 } },
      { id: "action-1", kind: "alert_action" as const, payload: { alertId: "alert-1" } },
    ];
    const processed = new Set<string>();
    await deliverQueuedWrites(queued, async () => ({
      outcomes: [
        { id: "checkin-1", status: "processed" },
        { id: "action-1", status: "already_processed" },
      ],
    }), async (ids) => ids.forEach((id) => processed.add(id)));
    expect(processed).toEqual(new Set(["checkin-1", "action-1"]));

    await expect(deliverQueuedWrites(queued, async () => ({
      outcomes: [{ id: "checkin-1", status: "processed" }],
    }), async (ids) => ids.forEach((id) => processed.add(id)))).rejects.toThrow("did not confirm every queued write");
    expect(processed).toEqual(new Set(["checkin-1", "action-1"]));
  });

  it("applies a locally injected scenario without changing unrelated days", () => {
    const baseline = buildLocalMission("crew-1");
    const scenario = buildLocalMission("crew-1", undefined, [
      { type: "sleep_deprivation", startDay: 14, durationDays: 2 },
    ]);
    expect(scenario.observations[14].metrics.sleep_hours).toBe(baseline.observations[14].metrics.sleep_hours - 2.7);
    expect(scenario.observations[17].metrics.sleep_hours).toBe(baseline.observations[17].metrics.sleep_hours);
  });

  it("uses the shared protocol matcher and strips escalation medication guidance", () => {
    const mission = buildLocalMission("crew-1");
    const protocol = findLocalProtocol({
      id: "synthetic-bp-red", crewId: "crew-1", day: 30, metric: "systolic_bp",
      severity: "red", status: "open", value: 140, baselineMean: 110,
      baselineStd: 3, zScore: 4, explanation: "Synthetic alert for protocol matching.",
    }, mission.protocols);
    expect(protocol?.tier).toBe("escalate");
    expect(protocol?.medication_category).toBeNull();
  });
});
