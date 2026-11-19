import { readFileSync } from "node:fs";
import {
  calculateBaselines, detectAlerts, matchProtocol, simulateMission,
} from "@vitalis/core";
import type { Protocol, ScenarioType } from "@vitalis/core";

const protocols = JSON.parse(readFileSync(new URL("../data/protocols.json", import.meta.url), "utf8")) as Protocol[];
const crewId = "crew-1";
const scenarios: { type: ScenarioType; startDay: number; durationDays: number }[] = [
  { type: "sleep_deprivation", startDay: 25, durationDays: 5 },
  { type: "bp_drift", startDay: 42, durationDays: 5 },
];
const observations = simulateMission({ crewId, seed: 100, days: 50, scenarios });
const baselines = calculateBaselines(observations);
const alerts = detectAlerts(observations, baselines);
const sleepAlert = alerts.find((alert) => alert.day === 25
  && (alert.relatedMetrics ?? [alert.metric]).some((metric) => metric === "sleep_hours" || metric === "sleep_efficiency"));
const bpAlert = alerts.find((alert) => alert.day === 43
  && (alert.relatedMetrics ?? [alert.metric]).some((metric) => metric === "systolic_bp" || metric === "diastolic_bp"));

if (!sleepAlert || !bpAlert) {
  throw new Error("Demo mission did not produce the expected deterministic alerts.");
}
const sleepProtocol = matchProtocol(sleepAlert, protocols);
const bpProtocol = matchProtocol(bpAlert, protocols);
if (!sleepProtocol || !bpProtocol || bpProtocol.tier !== "escalate" || bpProtocol.medication_category !== null) {
  throw new Error("Demo mission protocol safety check failed.");
}
if (sleepAlert.severity !== "amber" || bpAlert.severity !== "red") {
  throw new Error("Demo mission did not produce the expected amber sleep and red blood-pressure alerts.");
}

console.log("VITALIS OFFLINE DEMO MISSION");
console.log("1. Personal baseline: preflight days 1-7 recorded locally.");
console.log(`2. Sleep deprivation: ${sleepAlert.severity.toUpperCase()} on day ${sleepAlert.day + 1}.`);
console.log(`   Why: ${sleepAlert.explanation}`);
console.log(`3. Guided protocol: ${sleepProtocol.title} (${sleepProtocol.tier}); ${sleepProtocol.non_drug_steps[0]}`);
console.log(`4. Blood-pressure drift: ${bpAlert.severity.toUpperCase()} on day ${bpAlert.day + 1}.`);
console.log(`   Escalation: ${bpProtocol.title}; contact ground / follow the emergency procedure.`);
console.log("5. Escalation protocol contains no medication guidance.");
console.log("Network access was not used.");
