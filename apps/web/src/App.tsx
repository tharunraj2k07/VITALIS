import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { metricDomains } from "@vitalis/core";
import type { DomainScore, HealthAlert, MetricName, Observation, Protocol, ScenarioType } from "@vitalis/core";
import AnimatedValue from "./AnimatedValue";
import { buildChartData } from "./dashboard-data";
import MissionStatus from "./MissionStatus";
import { ReadinessOrbit, type OrbitMetric, type OrbitStatus } from "./ReadinessOrbit";
import {
  cacheRemoteSnapshot, deterministicSeed, enqueueWrite, findLocalProtocol, flushQueuedWrites,
  lastSyncTime, listLocalCrew, loadLocalSnapshot, markLocalAlert, queuedWriteCount, resetLocalDemo, runLocalScenario, saveCheckin,
} from "./offline-db";
import { motionDurations, durationFor } from "./motion";
import { retryWithBackoff } from "./retry";

const domains: DomainScore["domain"][] = ["cardiovascular", "sleep_immune", "musculoskeletal", "radiation", "behavioral_cognitive"];
const domainLabels: Record<DomainScore["domain"], string> = {
  cardiovascular: "Cardiovascular", sleep_immune: "Sleep and immune", musculoskeletal: "Musculoskeletal",
  radiation: "Radiation", behavioral_cognitive: "Behavior and cognition",
};
const domainMetrics: Record<DomainScore["domain"], MetricName> = {
  cardiovascular: "resting_hr", sleep_immune: "sleep_hours", musculoskeletal: "exercise_minutes",
  radiation: "radiation_dose_cumulative", behavioral_cognitive: "mood",
};
const metrics: { id: MetricName; label: string; unit: string }[] = [
  { id: "resting_hr", label: "Resting heart rate", unit: "bpm" },
  { id: "systolic_bp", label: "Systolic blood pressure", unit: "mmHg" },
  { id: "diastolic_bp", label: "Diastolic blood pressure", unit: "mmHg" },
  { id: "spo2", label: "Blood oxygen saturation", unit: "%" },
  { id: "skin_temp", label: "Skin temperature", unit: "°C" },
  { id: "sleep_hours", label: "Sleep duration", unit: "hours" },
  { id: "sleep_efficiency", label: "Sleep efficiency", unit: "%" },
  { id: "exercise_minutes", label: "Exercise", unit: "min" },
  { id: "radiation_dose_cumulative", label: "Cumulative radiation dose", unit: "units" },
  { id: "mood", label: "Mood", unit: "/10" },
  { id: "congestion", label: "Congestion", unit: "/10" },
  { id: "reaction_time", label: "Reaction time", unit: "s" },
];
const API_BASE = import.meta.env.VITE_API_URL ?? "";
type Crew = { id: string; name: string; role: string; missionDay: number };
type Baseline = { metric: MetricName; mean: number; std: number; sampleCount: number };
type ApiAlert = HealthAlert & { crew_id?: string; baseline_mean?: number; baseline_std?: number; z_score?: number; related_metrics?: string };
type Checkin = { day: number; mood: number; sleep_quality: number; congestion: number; headache: number; notes: string };
type ScenarioMarker = { id: string; type: ScenarioType; day: number };
type Toast = { id: number; message: string; priority: boolean };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function App({ onNavigate }: { onNavigate: (path: string) => void }) {
  const reducedMotion = useReducedMotion() ?? false;
  const [crew, setCrew] = useState<Crew[]>([]);
  const [crewId, setCrewId] = useState("");
  const [scores, setScores] = useState<DomainScore[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [alerts, setAlerts] = useState<ApiAlert[]>([]);
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [selectedAlertId, setSelectedAlertId] = useState("");
  const [selectedProtocol, setSelectedProtocol] = useState<Protocol | null>(null);
  const [protocolLoading, setProtocolLoading] = useState(false);
  const [protocolError, setProtocolError] = useState("");
  const [day, setDay] = useState(179);
  const [metric, setMetric] = useState<MetricName>("resting_hr");
  const [view, setView] = useState("overview");
  const [selectedDomain, setSelectedDomain] = useState<DomainScore["domain"] | null>(null);
  const [viewDirection, setViewDirection] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(true);
  const [connectionAttempt, setConnectionAttempt] = useState(1);
  const [connectionNotice, setConnectionNotice] = useState("");
  const [checkinMessage, setCheckinMessage] = useState("");
  const [online, setOnline] = useState(false);
  const [linkEnabled, setLinkEnabled] = useState(true);
  const [queueCount, setQueueCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [linkDelay, setLinkDelay] = useState(900);
  const [demoMessage, setDemoMessage] = useState("");
  const [demoRunning, setDemoRunning] = useState(false);
  const [scenarioMarkers, setScenarioMarkers] = useState<ScenarioMarker[]>([]);
  const [selectedScenario, setSelectedScenario] = useState<ScenarioMarker | null>(null);
  const [alertPulseId, setAlertPulseId] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSequence = useRef(0);
  const toastTimers = useRef<number[]>([]);
  const pulseTimer = useRef<number | undefined>(undefined);
  const announcedAlertIds = useRef(new Set<string>());
  const currentCrew = crew.find((member) => member.id === crewId);
  const showToast = useCallback((message: string, priority = false) => {
    const id = ++toastSequence.current;
    setToasts((current) => [...current.slice(-2), { id, message, priority }]);
    toastTimers.current.push(window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4200));
  }, []);

  useEffect(() => () => {
    toastTimers.current.forEach((timer) => window.clearTimeout(timer));
    if (pulseTimer.current !== undefined) window.clearTimeout(pulseTimer.current);
  }, []);
  const recordScenarioMarker = (type: ScenarioType, startDay: number) => {
    const marker = { id: `${type}-${startDay}-${Date.now()}-${toastSequence.current}`, type, day: startDay };
    setScenarioMarkers((current) => [...current, marker]);
    setSelectedScenario(marker);
  };
  const announceNewAlert = (alert: ApiAlert | undefined) => {
    if (!alert || announcedAlertIds.current.has(alert.id)) return;
    announcedAlertIds.current.add(alert.id);
    setAlertPulseId(alert.id);
    if (pulseTimer.current !== undefined) window.clearTimeout(pulseTimer.current);
    pulseTimer.current = window.setTimeout(() => setAlertPulseId(""), 1200);
    showToast(`${alert.severity === "red" ? "Red" : "Amber"} alert: ${alert.metric.replaceAll("_", " ")}. Review the explanation.`, true);
  };

  const connectToMissionServer = useCallback(async (isActive: () => boolean = () => true) => {
    if (isActive()) {
      setConnecting(true);
      setConnectionAttempt(1);
      setConnectionNotice("");
    }
    try {
      const members = await retryWithBackoff(() => api<Crew[]>("/api/crew"), {
        onRetry: (attempt) => { if (isActive()) setConnectionAttempt(attempt); },
      });
      if (members.length === 0) throw new Error("The mission server returned no crew members.");
      if (isActive()) {
        setCrew(members);
        setOnline(true);
      }
    } catch {
      if (isActive()) {
        setOnline(false);
        setConnectionNotice("Mission server unavailable after retries. Showing cached mission data.");
      }
    } finally {
      if (isActive()) setConnecting(false);
    }
  }, []);

  const refresh = useCallback(async (id = crewId, selectedDay = day, forceOnline = false) => {
    if (!id) return;
    setLoading(true);
    setError("");
    const showLocal = async () => {
      const snapshot = await loadLocalSnapshot(id, currentCrew?.name, selectedDay);
      setScores(snapshot.scores);
      setObservations(snapshot.observations);
      setBaselines(snapshot.baselines);
      setAlerts(snapshot.alerts);
      setProtocols(snapshot.protocols);
      setOnline(false);
    };
    if ((!linkEnabled && !forceOnline) || !navigator.onLine || (!online && !forceOnline)) {
      try {
        await showLocal();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Local health data could not be opened.");
      } finally {
        setLoading(false);
      }
      return;
    }
    try {
      const [scoreData, observationData, baselineData, alertData, protocolData] = await Promise.all([
        api<(DomainScore & { day: number })[]>(`/api/crew/${id}/scores?day=${selectedDay}`),
        api<Observation[]>(`/api/crew/${id}/observations?from=0&to=179`),
        api<Baseline[]>(`/api/crew/${id}/baseline`),
        api<ApiAlert[]>(`/api/crew/${id}/alerts`),
        api<Protocol[]>("/api/protocols"),
      ]);
      const normalizedAlerts = alertData.map((alert) => ({
        ...alert,
        crewId: alert.crewId ?? alert.crew_id ?? id,
        baselineMean: alert.baselineMean ?? alert.baseline_mean ?? 0,
        baselineStd: alert.baselineStd ?? alert.baseline_std ?? 0,
        zScore: alert.zScore ?? alert.z_score ?? 0,
        relatedMetrics: alert.relatedMetrics?.length ? alert.relatedMetrics : [alert.metric],
      }));
      setScores(scoreData);
      setObservations(observationData);
      setBaselines(baselineData);
      setAlerts(normalizedAlerts);
      setProtocols(protocolData);
      setOnline(true);
      if (currentCrew) {
        await cacheRemoteSnapshot(currentCrew, observationData, baselineData, normalizedAlerts, scoreData, protocolData);
      }
    } catch (reason) {
      setOnline(false);
      try {
        await showLocal();
      } catch (localReason) {
        setError(localReason instanceof Error ? localReason.message : reason instanceof Error ? reason.message : "Unable to load mission data.");
      }
    } finally {
      setLoading(false);
    }
  }, [crewId, day, linkEnabled, online, currentCrew]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const localMembers = await listLocalCrew();
        if (!active) return;
        setCrew(localMembers);
        setCrewId(localMembers[0]?.id ?? "");
        await connectToMissionServer(() => active);
      } catch (reason) {
        if (active) {
          setOnline(false);
          setConnecting(false);
          setError(reason instanceof Error ? reason.message : "Mission data could not be loaded from cache.");
        }
      }
    })();
    return () => { active = false; };
  }, [connectToMissionServer]);

  useEffect(() => {
    // This effect synchronizes server or cached data when the selected mission day changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (crewId && !connecting) void refresh(crewId, day);
  }, [crewId, day, online, connecting, refresh]);

  // This effect loads protocol details for the selected alert, including local offline fallbacks.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void Promise.all([queuedWriteCount(), lastSyncTime()])
      .then(([count, lastSync]) => {
        setQueueCount(count);
        setLastSyncedAt(lastSync);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Offline sync status could not be loaded."));
    const handleOnline = () => {
      setOnline(true);
      if (!linkEnabled) showToast("Ground link restored. Queued records will sync when the link is enabled.");
    };
    const handleOffline = () => {
      setOnline(false);
      showToast("Ground link lost. Local work will remain available.", true);
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [linkEnabled, showToast]);

  useEffect(() => {
    if (demoRunning || !online || !linkEnabled || queueCount === 0) return;
    const timer = window.setTimeout(() => {
      void flushQueuedWrites()
        .then(async () => {
          const remaining = await queuedWriteCount();
          setQueueCount(remaining);
          setLastSyncedAt(await lastSyncTime());
          if (queueCount > 0 && remaining === 0) showToast("Sync complete. The local queue is clear.");
          await refresh();
        })
        .catch((reason: unknown) => {
          setOnline(false);
          setError(reason instanceof Error ? reason.message : "Queued writes could not be synchronized.");
        });
    }, linkDelay);
    return () => window.clearTimeout(timer);
  }, [online, linkEnabled, queueCount, linkDelay, refresh, demoRunning, showToast]);

  useEffect(() => {
    if (!selectedAlertId) return;
    const alert = alerts.find((item) => item.id === selectedAlertId);
    if (!alert) return;
    if (!online || !linkEnabled) {
      setProtocolLoading(false);
      setProtocolError("");
      setSelectedProtocol(findLocalProtocol(alert, protocols) ?? null);
      return;
    }
    setProtocolLoading(true);
    setProtocolError("");
    api<Protocol>(`/api/alerts/${selectedAlertId}/protocol`)
      .then(setSelectedProtocol)
      .catch((reason: unknown) => {
        const fallback = findLocalProtocol(alert, protocols) ?? null;
        setSelectedProtocol(fallback);
        setProtocolError(fallback ? "" : reason instanceof Error ? reason.message : "The protocol could not be loaded.");
      })
      .finally(() => setProtocolLoading(false));
  }, [selectedAlertId, alerts, protocols, online, linkEnabled]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const currentObservation = observations.find((row) => row.day === day);
  const overall = scores.length ? Math.round(scores.reduce((sum, item) => sum + item.score, 0) / scores.length) : 0;
  const baseline = baselines.find((item) => item.metric === metric);
  const sortedAlerts = useMemo(() => [...alerts].sort((a, b) =>
    (b.severity === "red" ? 1 : 0) - (a.severity === "red" ? 1 : 0) || b.day - a.day), [alerts]);
  const selectedDayAlerts = sortedAlerts.filter((alert) => alert.day <= day);
  const chartData = useMemo(() => buildChartData(observations, alerts, metric, baseline), [observations, alerts, metric, baseline]);
  const activeAlert = alerts.find((alert) => alert.id === selectedAlertId);
  const statusByDomain = useMemo(() => {
    const result: Partial<Record<DomainScore["domain"], OrbitStatus>> = {};
    for (const alert of selectedDayAlerts) {
      if (alert.status !== "open") continue;
      const domain = metricDomains[alert.metric];
      const current = result[domain];
      if (alert.severity === "red" || current !== "red") {
        result[domain] = alert.severity === "red" ? "red" : "amber";
      }
    }
    return result;
  }, [selectedDayAlerts]);
  const metricsByDomain = useMemo(() => {
    const result: Partial<Record<DomainScore["domain"], OrbitMetric>> = {};
    for (const domain of domains) {
      const metricId = domainMetrics[domain];
      const observation = [...observations].reverse().find((row) => row.day <= day);
      const value = observation?.metrics[metricId];
      const stats = baselines.find((item) => item.metric === metricId);
      result[domain] = {
        label: metrics.find((item) => item.id === metricId)?.label ?? metricId.replaceAll("_", " "),
        value: typeof value === "number" ? `${value} ${metrics.find((item) => item.id === metricId)?.unit ?? ""}` : "No reading",
        trend: typeof value === "number" && stats
          ? Math.abs(value - stats.mean) > stats.std ? "outside the baseline band" : "within the baseline band"
          : "baseline unavailable",
      };
    }
    return result;
  }, [observations, day, baselines]);
  const currentPhase = currentObservation?.phase ?? "mid_mission";
  const timelineAlerts = selectedDayAlerts;

  function navigateView(next: string) {
    const order = ["overview", "metrics", "alerts", "checkin", "timeline", "demo"];
    setViewDirection(order.indexOf(next) >= order.indexOf(view) ? 1 : -1);
    setView(next);
  }

  function selectOrbitDomain(domain: DomainScore["domain"]) {
    setSelectedDomain(domain);
    setMetric(domainMetrics[domain]);
    navigateView("metrics");
  }

  async function submitCheckin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload: Checkin = {
      day, mood: Number(form.get("mood")), sleep_quality: Number(form.get("sleep_quality")),
      congestion: Number(form.get("congestion")), headache: Number(form.get("headache")), notes: String(form.get("notes") ?? ""),
    };
    await saveCheckin(crewId, payload);
    if (online && linkEnabled) {
      try {
        await api(`/api/crew/${crewId}/checkins`, { method: "POST", body: JSON.stringify(payload) });
        setCheckinMessage("Check-in recorded for the mission log.");
        event.currentTarget.reset();
      } catch {
        await enqueueWrite("checkin", { ...payload, crewId });
        setCheckinMessage("Saved offline. Check-in queued for sync.");
      }
    } else {
      await enqueueWrite("checkin", { ...payload, crewId });
      setCheckinMessage("Saved offline. Check-in queued for sync.");
    }
    setQueueCount(await queuedWriteCount());
    showToast(online && linkEnabled ? "Check-in saved to the mission log." : "Check-in saved locally and queued for sync.");
  }

  async function markActionTaken() {
    if (!selectedAlertId) return;
    const action = "Crew member marked protocol action taken.";
    if (online && linkEnabled) {
      try {
        await api(`/api/alerts/${selectedAlertId}/actions`, { method: "POST", body: JSON.stringify({ action }) });
        await api(`/api/alerts/${selectedAlertId}`, { method: "PATCH", body: JSON.stringify({ status: "acknowledged" }) });
        await refresh();
        showToast("Action marked as taken.");
        return;
      } catch {
        setOnline(false);
      }
    }
    await enqueueWrite("alert_action", { alertId: selectedAlertId, action });
    await markLocalAlert(selectedAlertId, "acknowledged");
    setAlerts((current) => current.map((alert) => alert.id === selectedAlertId ? { ...alert, status: "acknowledged" } : alert));
    setQueueCount(await queuedWriteCount());
    showToast("Action marked as taken and queued for sync.");
  }

  async function injectScenario(type: ScenarioType, forceOnline = false) {
    if (!crewId) return;
    const starts: Record<ScenarioType, number> = {
      sleep_deprivation: 25, bp_drift: 42, solar_particle_event: 60,
      isolation_mood_decline: 55, bone_muscle_decline: 70,
    };
    const payload = { crewId, type, startDay: starts[type], durationDays: 5 };
    if ((online || forceOnline) && (linkEnabled || forceOnline) && navigator.onLine) {
      try {
        await api("/api/scenarios", { method: "POST", body: JSON.stringify(payload) });
        const updatedAlerts = await api<ApiAlert[]>(`/api/crew/${crewId}/alerts`);
        const newAlert = updatedAlerts.find((alert) => !alerts.some((current) => current.id === alert.id));
        recordScenarioMarker(type, starts[type]);
        announceNewAlert(newAlert);
        await refresh(crewId, day, forceOnline);
        setDemoMessage(`${type.replaceAll("_", " ")} injected on mission day ${starts[type] + 1}.`);
        showToast(`${type.replaceAll("_", " ")} added to the mission timeline.`);
        return;
      } catch {
        setOnline(false);
      }
    }
    await runLocalScenario(crewId, type, payload.startDay, payload.durationDays);
    await enqueueWrite("scenario", payload);
    recordScenarioMarker(type, payload.startDay);
    setQueueCount(await queuedWriteCount());
    const snapshot = await loadLocalSnapshot(crewId, currentCrew?.name, day);
    setScores(snapshot.scores);
    setObservations(snapshot.observations);
    setBaselines(snapshot.baselines);
    setAlerts(snapshot.alerts);
    setProtocols(snapshot.protocols);
    setDemoMessage(`${type.replaceAll("_", " ")} computed locally and queued for sync.`);
    announceNewAlert(snapshot.alerts.find((alert) => !alerts.some((current) => current.id === alert.id)));
    showToast(`${type.replaceAll("_", " ")} calculated locally and queued for sync.`);
  }

  async function runDemoSequence() {
    if (!crewId) return;
    setDemoRunning(true);
    try {
      await resetDemoMission(true);
      setLinkEnabled(true);
      setOnline(navigator.onLine);
      const step = async (caption: string, durationMs: number) => {
        setDemoMessage(caption);
        await new Promise((resolve) => window.setTimeout(resolve, durationMs));
      };
      setDay(6);
      await step("STEP 1 / 9 · Healthy baseline — seven preflight days establish this crew member’s personal reference.", 15_000);
      setDay(14);
      await step("STEP 2 / 9 · Launch and adaptation — the demo is viewing early congestion changes against that baseline.", 20_000);

      await injectScenario("sleep_deprivation", true);
      setDay(25);
      await step("STEP 3 / 9 · Sleep deprivation injected — sleep duration and efficiency drift from the personal baseline.", 20_000);
      const getMissionAlerts = async () => {
        if (navigator.onLine) {
          try {
            return await api<ApiAlert[]>(`/api/crew/${crewId}/alerts`);
          } catch {
            setOnline(false);
          }
        }
        return (await loadLocalSnapshot(crewId, currentCrew?.name, 179)).alerts;
      };
      const sleepAlerts = await getMissionAlerts();
      const sleepAlert = sleepAlerts.find((alert) =>
        alert.day === 25 && (alert.relatedMetrics ?? [alert.metric])
          .some((metric) => metric === "sleep_hours" || metric === "sleep_efficiency"));
      if (!sleepAlert) throw new Error("The deterministic sleep scenario did not produce its expected alert.");
      setSelectedAlertId(sleepAlert.id);
      setView("alerts");
      announceNewAlert(sleepAlert);
      await step("STEP 4 / 9 · Amber alert — the detected sleep change is explained relative to the crew member’s preflight baseline.", 20_000);
      await step("STEP 5 / 9 · Protocol opened — review the unverified draft’s steps, source checklist, and safety disclaimer.", 20_000);

      await injectScenario("bp_drift", true);
      setDay(43);
      const bpAlerts = await getMissionAlerts();
      const bpAlert = bpAlerts.find((alert) =>
        alert.day === 43 && (alert.relatedMetrics ?? [alert.metric])
          .some((metric) => metric === "systolic_bp" || metric === "diastolic_bp"));
      if (!bpAlert) throw new Error("The deterministic blood-pressure scenario did not produce its expected alert.");
      setSelectedAlertId(bpAlert.id);
      setView("alerts");
      announceNewAlert(bpAlert);
      await step("STEP 6 / 9 · Blood-pressure drift injected — repeated change is compared with the same personal baseline.", 20_000);
      await step(`STEP 7 / 9 · ${bpAlert.severity.toUpperCase()} alert — the escalation-tier protocol contains no medication guidance.`, 20_000);

      setLinkEnabled(false);
      showToast("Ground link lost. Local scoring continues and new work is queued.", true);
      setDay(80);
      const offlinePayload = { crewId, type: "sleep_deprivation" as const, startDay: 80, durationDays: 2 };
      await runLocalScenario(crewId, offlinePayload.type, offlinePayload.startDay, offlinePayload.durationDays);
      recordScenarioMarker(offlinePayload.type, offlinePayload.startDay);
      const demoCheckin = {
        day: 80, mood: 7, sleep_quality: 3, congestion: 1, headache: 0,
        notes: "Deterministic demo offline check-in.",
      };
      await saveCheckin(crewId, demoCheckin);
      await enqueueWrite("scenario", offlinePayload);
      await enqueueWrite("checkin", { ...demoCheckin, crewId });
      setQueueCount(await queuedWriteCount());
      const local = await loadLocalSnapshot(crewId, currentCrew?.name, 179);
      setScores(local.scores);
      setObservations(local.observations);
      setBaselines(local.baselines);
      setAlerts(local.alerts);
      setProtocols(local.protocols);
      await step("STEP 8 / 9 · Ground link disabled — local scoring and protocol matching still work; a check-in and scenario are queued.", 20_000);

      setLinkEnabled(true);
      setOnline(navigator.onLine);
      showToast("Ground link restored. Syncing queued records.");
      await step("STEP 9 / 9 · Ground link restored — waiting the configured link delay, then syncing queued writes.", linkDelay);
      if (navigator.onLine) {
        await flushQueuedWrites();
        setLastSyncedAt(await lastSyncTime());
      } else {
        setDemoMessage("STEP 9 / 9 · Link restored in the demo; browser network is still unavailable, so writes remain queued.");
      }
      setQueueCount(await queuedWriteCount());
      await new Promise((resolve) => window.setTimeout(resolve, Math.max(0, 25_000 - linkDelay)));
      setDemoMessage("DEMO COMPLETE · Baseline → adaptation → amber protocol → red escalation → offline work → restored link and sync.");
    } finally {
      setDemoRunning(false);
    }
  }

  async function resetDemoMission(forceOnline = false) {
    if (!crewId) return;
    setError("");
    if (navigator.onLine && (linkEnabled || forceOnline)) {
      try {
        await api(`/api/crew/${crewId}/simulate`, {
          method: "POST",
          body: JSON.stringify({ seed: deterministicSeed(crewId), resetScenarios: true }),
        });
      } catch {
        setOnline(false);
      }
    }
    await resetLocalDemo(crewId);
    announcedAlertIds.current.clear();
    setScenarioMarkers([]);
    setSelectedScenario(null);
    setAlertPulseId("");
    const snapshot = await loadLocalSnapshot(crewId, currentCrew?.name, 179);
    setScores(snapshot.scores);
    setObservations(snapshot.observations);
    setBaselines(snapshot.baselines);
    setAlerts(snapshot.alerts);
    setProtocols(snapshot.protocols);
    setSelectedAlertId("");
    setSelectedProtocol(null);
    setDay(6);
    setView("overview");
    setQueueCount(await queuedWriteCount());
    setLastSyncedAt(await lastSyncTime());
    setDemoMessage("Demo reset to the deterministic healthy mission baseline.");
    if (!forceOnline) showToast("Demo mission reset to the healthy baseline.");
  }

  function toggleCommunicationsLink() {
    if (!online) {
      setLinkEnabled(true);
      if (navigator.onLine) void connectToMissionServer();
      return;
    }
    if (!linkEnabled) {
      setLinkEnabled(true);
      showToast("Ground link restored. Queued records will sync shortly.");
    } else {
      setLinkEnabled(false);
      showToast("Ground link lost. Local work will be queued.", true);
    }
  }

  async function runSafely(action: () => Promise<void>) {
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The requested action could not be completed.");
    }
  }

  const sections = [
    ["overview", "Overview"], ["metrics", "Metrics"], ["alerts", "Alerts"],
    ["checkin", "Check-in"], ["timeline", "Timeline"], ["demo", "Demo"],
  ];
  const selectedChartData = chartData.filter((point) => point.day <= day);
  const currentMetricValue = currentObservation?.metrics[metric];
  const currentChartPoint = selectedChartData.find((point) => point.day === day);
  const metricInfo = metrics.find((item) => item.id === metric);

  return (
    <div className={`mission-shell ${online && linkEnabled ? "" : "link-lost"}`} data-phase={String(currentPhase).replaceAll("_", "-")}>
      <header className="mission-topbar">
        <a className="mission-brand" href="/" onClick={(event) => { event.preventDefault(); onNavigate("/"); }} aria-label="VITALIS story page">
          <span className="brand-sigil" aria-hidden="true">V</span><span>VITALIS<small>CREW HEALTH, IN CONTEXT</small></span>
        </a>
        <div className="mission-meta"><strong>Deep space transit</strong><span>Simulated mission · 180 days</span></div>
        <label className="crew-select">Crew member
          <select value={crewId} onChange={(event) => setCrewId(event.target.value)} aria-label="Select crew member">
            {crew.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}
          </select>
        </label>
      </header>
      <div className="mission-main">
        <MissionStatus online={online} linkEnabled={linkEnabled} queueCount={queueCount}
          lastSyncedAt={lastSyncedAt} connecting={connecting} onToggle={toggleCommunicationsLink} />
        {connectionNotice && <div className="error-banner" role="status"><span>{connectionNotice}</span><button type="button" onClick={() => void connectToMissionServer()}>Retry connection</button></div>}
        {error && <div className="error-banner" role="alert"><span>{error}</span><button type="button" onClick={() => void refresh()}>Retry loading mission data</button></div>}
        <div className="mission-heading">
          <div><p className="section-kicker"><span />Mission health · {currentCrew?.role ?? "Crew"}</p>
            <h1>{currentCrew?.name ?? "Mission overview"}</h1>
            <p>Health trends interpreted against each crew member’s own baseline.</p>
          </div>
          <div className="mission-day"><span>Mission day</span><strong className="display-number">{String(day + 1).padStart(3, "0")}</strong><small>of 180</small></div>
        </div>
        <nav className="mission-tabs" aria-label="Mission control sections">
          {sections.map(([key, title]) => <button key={key} type="button" className={view === key ? "is-current" : ""}
            aria-current={view === key ? "page" : undefined} onClick={() => navigateView(key)}>{title}</button>)}
        </nav>
        {demoMessage && <div className="demo-caption" role="status" aria-live="polite">{demoMessage}</div>}
        {connecting && !loading && <div className="loading-panel" role="status"><span className="spinner" />Connecting to mission server… (attempt {connectionAttempt} of 5)</div>}
        {loading && <div className="loading-panel" role="status"><span className="spinner" />{connecting
          ? <>Connecting to mission server… (attempt {connectionAttempt} of 5)</>
          : "Loading mission data from local cache…"}</div>}
        {!loading && (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={view} className="mission-view"
              initial={{ opacity: 0, x: reducedMotion ? 0 : viewDirection * 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: reducedMotion ? 0 : viewDirection * -8 }}
              transition={{ duration: durationFor(reducedMotion, motionDurations.base), ease: [0.22, 1, 0.36, 1] }}>
              {view === "overview" && (
                <div className="overview-view">
                  {observations.length === 0 && <Empty text="No mission observations are available yet. Retry the server connection or reload cached mission data." />}
                  <section className="overview-lead">
                    <div className="orbit-heading"><span>Readiness orbit</span><span>Day {day + 1} · {currentObservation?.phase?.replaceAll("_", " ") ?? "Mission in progress"}</span></div>
                    <ReadinessOrbit scores={scores} overall={overall} statusByDomain={statusByDomain} metricsByDomain={metricsByDomain}
                      className="orbit-dashboard" onSelectDomain={selectOrbitDomain} />
                    <div className="orbit-summary">
                      <p>Five health domains, read against this crew member’s preflight baseline.</p>
                      <button type="button" className="button button-outline" onClick={() => navigateView("metrics")}>Explore metrics</button>
                    </div>
                  </section>
                  <section className="journey-control panel-frame">
                    <div className="section-title"><div><p className="section-kicker"><span />Mission playback</p><h2>Follow the journey</h2></div>
                      <span className="quiet-readout">Day {day + 1} of 180</span></div>
                    <label className="range-label" htmlFor="overview-day">Scrub the mission day</label>
                    <input id="overview-day" className="mission-range" type="range" min="0" max="179" value={day}
                      onChange={(event) => setDay(Number(event.target.value))} aria-label={`Mission day ${day + 1} of 180`} />
                    <div className="journey-endpoints"><span>Launch</span><span>Adaptation</span><span>Mid-mission</span><span>Return</span></div>
                  </section>
                  <section className="overview-lower">
                    <div className="panel-frame trend-preview">
                      <div className="section-title"><div><p className="section-kicker"><span />Personal trend</p><h2>Resting heart rate</h2></div>
                        <button type="button" className="text-link" onClick={() => { setMetric("resting_hr"); navigateView("metrics"); }}>View detail</button></div>
                      <TrendChart data={buildChartData(observations.filter((row) => row.day <= day), alerts, "resting_hr", baselines.find((item) => item.metric === "resting_hr"))}
                        baseline={baselines.find((item) => item.metric === "resting_hr")} unit="bpm" />
                      <p className="chart-caption">The shaded band shows the preflight baseline range.</p>
                    </div>
                    <div className="panel-frame alerts-preview">
                      <div className="section-title"><div><p className="section-kicker"><span />Attention</p><h2>Recent alerts</h2></div>
                        <button type="button" className="text-link" onClick={() => navigateView("alerts")}>All alerts</button></div>
                      {selectedDayAlerts.slice(0, 4).map((alert) => (
                        <button type="button" className={`mini-alert ${alert.severity}`} key={alert.id}
                          onClick={() => { setSelectedAlertId(alert.id); navigateView("alerts"); }}>
                          <span className={`severity-mark ${alert.severity}`} aria-hidden="true">{alert.severity === "red" ? "!" : "◷"}</span>
                          <span className="mini-alert-copy"><b>{alert.metric.replaceAll("_", " ")}</b><small>Mission day {alert.day + 1} · {alert.severity === "red" ? "Red alert" : "Amber alert"}</small></span>
                          <span className="severity-word">{alert.severity === "red" ? "Red" : "Amber"}</span>
                        </button>
                      ))}
                      {selectedDayAlerts.length === 0 && <Empty text="No alerts through this mission day." />}
                    </div>
                  </section>
                  <section className="demo-teaser panel-frame">
                    <div><p className="section-kicker"><span />A guided walkthrough</p><h2>See the mission flow</h2>
                      <p>Run a deterministic demonstration of baseline monitoring, alerts, protocols, offline work and sync.</p></div>
                    <div className="demo-teaser-actions">
                      <button type="button" className="button button-gold" disabled={demoRunning} onClick={() => void runSafely(runDemoSequence)}>
                        {demoRunning ? "Demo mission running" : "Run demo mission"}
                      </button>
                      <button type="button" className="text-link" onClick={() => navigateView("demo")}>Open demo controls</button>
                    </div>
                  </section>
                </div>
              )}
              {view === "metrics" && (
                <section className="panel-frame metric-panel">
                  <div className="section-title metric-title">
                    <div><p className="section-kicker"><span />Baseline comparison</p>
                      <motion.h2 layoutId={selectedDomain ? `domain-${selectedDomain}` : undefined}>
                        {selectedDomain ? domainLabels[selectedDomain] : "Metric detail"}
                      </motion.h2>
                      <p>Compare a daily reading with this crew member’s preflight reference.</p>
                    </div>
                    <label className="select-field">Choose metric
                      <select value={metric} onChange={(event) => setMetric(event.target.value as MetricName)} aria-label="Choose metric">
                        {metrics.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="metric-readout">
                    <strong className="display-number">{typeof currentMetricValue === "number" ? <AnimatedValue value={currentMetricValue} /> : "—"}</strong>
                    <span>{metricInfo?.unit}</span><span className="quiet-readout">Mission day {day + 1}</span>
                  </div>
                  <div className="baseline-spec" aria-label="Baseline statistics">
                    <div><span>Preflight mean</span><strong>{baseline?.mean.toFixed(2) ?? "Unavailable"}{baseline ? ` ${metricInfo?.unit ?? ""}` : ""}</strong></div>
                    <div><span>Standard deviation</span><strong>{baseline?.std.toFixed(2) ?? "Unavailable"}{baseline ? ` ${metricInfo?.unit ?? ""}` : ""}</strong></div>
                    <div><span>Baseline readings</span><strong>{baseline?.sampleCount ?? "Unavailable"}</strong></div>
                    <div><span>Current z-score</span><strong>{Number.isFinite(currentChartPoint?.zScore) ? currentChartPoint?.zScore?.toFixed(2) : "Unavailable"}</strong></div>
                  </div>
                  <TrendChart data={selectedChartData} baseline={baseline} unit={metricInfo?.unit ?? ""} tall label={metricInfo?.label ?? "Metric"} />
                  <p className="chart-caption">The shaded band represents one standard deviation around the preflight mean. Markers identify readings associated with a detected alert.</p>
                </section>
              )}
              {view === "alerts" && (
                <section className="alert-layout">
                  <div className="panel-frame alert-list">
                    <div className="section-title"><div><p className="section-kicker"><span />Personal baseline deviations</p><h2>Alerts</h2></div>
                      <span className="quiet-readout">{sortedAlerts.length} total</span></div>
                    {sortedAlerts.map((alert) => {
                      const protocol = findLocalProtocol(alert, protocols);
                      return <details className={`alert-entry ${selectedAlertId === alert.id ? "selected" : ""} ${alertPulseId === alert.id ? "is-pulsing" : ""}`} key={alert.id}
                        onToggle={(event) => {
                          if (event.currentTarget.open) setSelectedAlertId(alert.id);
                          else if (selectedAlertId === alert.id) setSelectedAlertId("");
                        }}>
                        <motion.summary layoutId={selectedAlertId === alert.id ? undefined : `alert-${alert.id}`} className="alert-row">
                          <span className={`severity-mark ${alert.severity}`} aria-hidden="true">{alert.severity === "red" ? "!" : "◷"}</span>
                          <span className="alert-main"><b>{alert.metric.replaceAll("_", " ")}</b>
                            <small>Mission day {alert.day + 1} · {alert.severity === "red" ? "Red alert" : "Amber alert"} · {alert.status}</small></span>
                          <span className="severity-word">{alert.severity === "red" ? "Red" : "Amber"}</span>
                        </motion.summary>
                        <div className="alert-expanded">
                          <h3>Why flagged</h3><p>{alert.explanation}</p>
                          <h3>Matched protocol</h3>
                          {protocol ? <><p><strong>{protocol.title}</strong></p><p>{protocol.non_drug_steps[0]}</p></>
                            : <p>No response protocol matches this alert.</p>}
                          <button type="button" className="text-link" onClick={() => setSelectedAlertId(alert.id)}>Open full protocol</button>
                        </div>
                      </details>;
                    })}
                    {sortedAlerts.length === 0 && <Empty text="No health alerts are available for this mission." />}
                  </div>
                  <ProtocolPanel protocol={selectedProtocol} alert={activeAlert} loading={protocolLoading} error={protocolError}
                    onAction={() => void runSafely(markActionTaken)} />
                </section>
              )}
              {view === "checkin" && (
                <section className="panel-frame checkin-panel">
                  <p className="section-kicker"><span />Crew self-report · Mission day {day + 1}</p><h2>Daily check-in</h2>
                  <p className="panel-intro">Record how you are feeling. Your entry is saved to the mission health log and can be queued while offline.</p>
                  <form onSubmit={(event) => void runSafely(() => submitCheckin(event))} className="checkin-form">
                    <label>Mood <span>1 is low; 10 is good</span><input name="mood" type="range" min="1" max="10" defaultValue="7" /></label>
                    <label>Sleep quality<select name="sleep_quality" defaultValue="3"><option value="1">1 · Very poor</option><option value="2">2 · Poor</option><option value="3">3 · Fair</option><option value="4">4 · Good</option><option value="5">5 · Restful</option></select></label>
                    <label>Congestion or head fullness <span>0 is none; 10 is severe</span><input name="congestion" type="range" min="0" max="10" defaultValue="1" /></label>
                    <label>Headache <span>0 is none; 10 is severe</span><input name="headache" type="range" min="0" max="10" defaultValue="0" /></label>
                    <label className="wide">Notes <textarea name="notes" rows={4} maxLength={1000} placeholder="Optional context for this check-in" /></label>
                    <button type="submit" className="button button-gold">Save check-in</button>
                    {checkinMessage && <p role="status" className="form-message">{checkinMessage}</p>}
                  </form>
                </section>
              )}
              {view === "timeline" && (
                <section className="panel-frame timeline-panel">
                  <div className="section-title"><div><p className="section-kicker"><span />Mission timeline</p><h2>Launch to return</h2></div>
                    <span className="quiet-readout">Day {day + 1} of 180</span></div>
                  <p className="panel-intro">Scroll across the mission or use the slider to inspect daily readiness and alerts.</p>
                  {observations.length === 0 ? <Empty text="No mission timeline data is available. Retry the server or load cached mission data." /> : (
                    <>
                      <div className="journey-scroll" role="group" aria-label="Scrollable mission timeline">
                        <div className="journey-track" aria-label={`Mission day ${day + 1}; phase ${String(currentPhase).replaceAll("_", " ")}`}>
                          <span className="journey-progress" style={{ width: `${day / 179 * 100}%` }} />
                          {[
                            { label: "Launch", position: 0 }, { label: "Adaptation", position: 12 },
                            { label: "Mid-mission", position: 52 }, { label: "Return", position: 100 },
                          ].map((phase) => <div className="journey-phase" key={phase.label} style={{ left: `${phase.position}%` }}>
                            <span aria-hidden="true" />{phase.label}
                          </div>)}
                          {timelineAlerts.map((alert) => <button type="button" key={alert.id}
                            className={`journey-alert ${alert.severity}`} style={{ left: `${alert.day / 179 * 100}%` }}
                            title={`${alert.severity === "red" ? "Red" : "Amber"} alert, mission day ${alert.day + 1}`}
                            aria-label={`Open ${alert.severity === "red" ? "red" : "amber"} alert on mission day ${alert.day + 1}`}
                            onClick={() => { setSelectedAlertId(alert.id); navigateView("alerts"); }}>{alert.severity === "red" ? "!" : "◷"}</button>)}
                          {scenarioMarkers.map((marker) => <motion.button type="button" key={marker.id}
                            layoutId={selectedScenario?.id === marker.id ? undefined : `scenario-${marker.id}`}
                            initial={{ opacity: 0, x: "-50%", y: reducedMotion ? 0 : -14, scale: reducedMotion ? 1 : 0.8 }}
                            animate={{ opacity: 1, x: "-50%", y: 0, scale: 1 }}
                            transition={{ duration: durationFor(reducedMotion, motionDurations.base) }}
                            className="journey-scenario" style={{ left: `${marker.day / 179 * 100}%` }}
                            aria-label={`Show ${marker.type.replaceAll("_", " ")} scenario on mission day ${marker.day + 1}`}
                            onClick={() => setSelectedScenario(marker)}>◆</motion.button>)}
                          <div className="journey-cursor" style={{ left: `${day / 179 * 100}%` }} aria-hidden="true" />
                        </div>
                      </div>
                      <div className="journey-legend"><span><i className="legend-red">!</i> Red alert</span><span><i className="legend-amber">◷</i> Amber alert</span><span><i className="legend-scenario">◆</i> Scenario injected</span></div>
                      <label className="range-label" htmlFor="timeline-day">Mission day {day + 1}
                        <input id="timeline-day" className="mission-range" type="range" min="0" max="179" value={day}
                          onChange={(event) => setDay(Number(event.target.value))} aria-label={`Mission day ${day + 1} of 180`} />
                      </label>
                      <div className="timeline-facts">
                        <div><span>Current phase</span><strong>{String(currentPhase).replaceAll("_", " ")}</strong></div>
                        <div><span>Alerts this day</span><strong>{alerts.filter((alert) => alert.day === day).length}</strong></div>
                        <div><span>Readiness</span><strong>{overall || "Unavailable"}</strong></div>
                      </div>
                      <AnimatePresence mode="wait">
                        {selectedScenario && <motion.div className="scenario-detail panel-frame" layoutId={`scenario-${selectedScenario.id}`}
                          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                          transition={{ duration: durationFor(reducedMotion, motionDurations.fast) }}>
                          <div><p className="section-kicker"><span />Scenario marker · Mission day {selectedScenario.day + 1}</p>
                            <h3>{selectedScenario.type.replaceAll("_", " ")}</h3>
                            <p>This simulated change was injected into the mission timeline.</p></div>
                          <button type="button" className="text-link" onClick={() => setSelectedScenario(null)}>Close detail</button>
                        </motion.div>}
                      </AnimatePresence>
                    </>
                  )}
                </section>
              )}
              {view === "demo" && (
                <section className="panel-frame demo-panel">
                  <div className="section-title"><div><p className="section-kicker"><span />Simulation environment</p><h2>Demo control panel</h2></div>
                    <span className="quiet-readout">Deterministic mission data</span></div>
                  <p className="panel-intro">Run the guided sequence or inject one simulated scenario at a time. Local scoring and protocol matching remain available without a ground link.</p>
                  <div className="demo-primary-actions">
                    <button type="button" className="button button-gold" disabled={demoRunning} onClick={() => void runSafely(runDemoSequence)}>
                      {demoRunning ? "Demo mission running" : "Run demo mission"}
                    </button>
                    <button type="button" className="button button-outline" disabled={demoRunning} onClick={() => void runSafely(() => resetDemoMission())}>Reset demo</button>
                  </div>
                  <div className="scenario-control">
                    <h3>Inject a scenario</h3>
                    <div className="scenario-buttons">
                      <button type="button" onClick={() => void runSafely(() => injectScenario("sleep_deprivation"))}>Sleep deprivation</button>
                      <button type="button" onClick={() => void runSafely(() => injectScenario("bp_drift"))}>Blood-pressure drift</button>
                      <button type="button" onClick={() => void runSafely(() => injectScenario("solar_particle_event"))}>Solar particle event</button>
                      <button type="button" onClick={() => void runSafely(() => injectScenario("isolation_mood_decline"))}>Isolation mood decline</button>
                      <button type="button" onClick={() => void runSafely(() => injectScenario("bone_muscle_decline"))}>Bone and muscle decline</button>
                    </div>
                  </div>
                  <div className="demo-settings">
                    <button type="button" className="button button-outline" onClick={toggleCommunicationsLink}
                      aria-pressed={online && linkEnabled}>{linkEnabled ? "Disable ground link" : "Restore ground link"}</button>
                    <label className="delay-control">Simulated ground-link delay <strong>{(linkDelay / 1000).toFixed(1)} seconds</strong>
                      <input type="range" min="0" max="5000" step="250" value={linkDelay} onChange={(event) => setLinkDelay(Number(event.target.value))}
                        aria-label="Simulated ground-link delay" />
                    </label>
                  </div>
                  <ol className="demo-script">
                    <li>Establish a healthy personal baseline.</li><li>Observe launch and adaptation.</li>
                    <li>Inject sleep deprivation and review the amber alert.</li><li>Open its unverified draft protocol.</li>
                    <li>Inject blood-pressure drift and review its escalation-tier alert.</li>
                    <li>Disable the ground link, then demonstrate local check-in and queueing.</li>
                    <li>Restore the link and verify queued records sync.</li>
                  </ol>
                </section>
              )}
            </motion.div>
          </AnimatePresence>
        )}
        <AnimatePresence>
          <div className="toast-region" aria-live="polite" aria-relevant="additions text">
            {toasts.map((toast) => <motion.div key={toast.id} className={`mission-toast ${toast.priority ? "priority" : ""}`}
              role={toast.priority ? "alert" : "status"} initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reducedMotion ? 0 : -5 }}
              transition={{ duration: durationFor(reducedMotion, motionDurations.fast) }}>{toast.message}</motion.div>)}
          </div>
        </AnimatePresence>
        <footer className="mission-footer"><span>VITALIS prototype · Simulated data</span><span>Decision support only, not medical advice.</span>
          <button type="button" className="text-link" onClick={() => onNavigate("/")}>Return to the story</button></footer>
      </div>
    </div>
  );
}

function TrendChart({ data, baseline, unit, tall = false, label = "Metric trend" }: {
  data: { day: number; value: number; flagged: boolean; zScore?: number }[];
  baseline?: Baseline;
  unit: string;
  tall?: boolean;
  label?: string;
}) {
  const band = baseline ? [baseline.mean - baseline.std, baseline.mean + baseline.std] : undefined;
  const first = data[0];
  const last = data[data.length - 1];
  const alternative = first && last
    ? `${label} changed from ${first.value} to ${last.value} ${unit} between mission days ${first.day + 1} and ${last.day + 1}${baseline ? `. The preflight mean is ${baseline.mean.toFixed(2)} ${unit}, with a standard deviation of ${baseline.std.toFixed(2)}.` : "."}`
    : `No readings are available for ${label.toLowerCase()}.`;
  return <figure className={`chart-figure ${tall ? "tall" : ""}`} aria-label={`${label} chart`}>
    <div className={`chart ${tall ? "tall" : ""}`} role="group" aria-label={`${label} values and z-scores`}>
    {data.length === 0 ? <Empty text="No observations available for this metric." /> :
      <ResponsiveContainer width="100%" height="100%">
        <LineChart accessibilityLayer data={data} margin={{ top: 10, right: 12, bottom: 0, left: -20 }}>
          <CartesianGrid stroke="rgba(201, 162, 75, 0.16)" vertical={false} />
          <XAxis dataKey="day" tickFormatter={(value) => `${Number(value) + 1}`} stroke="#bac3d8" tickLine={false} axisLine={false} />
          <YAxis stroke="#bac3d8" tickLine={false} axisLine={false} width={48} domain={["auto", "auto"]} />
          <Tooltip contentStyle={{ background: "#0b1433", border: "1px solid #c9a24b", borderRadius: 4, color: "#eef1f8" }} labelFormatter={(value) => `Mission day ${Number(value) + 1}`} formatter={(value, _name, item) => {
            const zScore = item.payload?.zScore;
            return [`${value} ${unit}; z-score ${Number.isFinite(zScore) ? Number(zScore).toFixed(2) : "unavailable"}`, "Observed"];
          }} />
          {band && <ReferenceArea y1={band[0]} y2={band[1]} fill="#35d0ba" fillOpacity={0.12} />}
          {baseline && <ReferenceLine y={baseline.mean} stroke="#35d0ba" strokeDasharray="5 5" />}
          <Line type="monotone" dataKey="value" stroke="#35d0ba" strokeWidth={2} dot={(props) => {
            const point = data[props.index];
            return point?.flagged
              ? <Fragment key={`dot-${props.index}`}><circle cx={props.cx} cy={props.cy} r={4} fill="#f0b24b" stroke="#0b1433" strokeWidth={2} /></Fragment>
              : <Fragment key={`dot-${props.index}`} />;
          }} activeDot={{ r: 5, fill: "#eef1f8" }} />
        </LineChart>
      </ResponsiveContainer>}
    </div>
    <figcaption className="chart-alternative">{alternative}</figcaption>
  </figure>;
}

export function ProtocolPanel({ protocol, alert, loading, error, onAction }: {
  protocol: Protocol | null;
  alert?: ApiAlert;
  loading: boolean;
  error: string;
  onAction: () => void;
}) {
  const reducedMotion = useReducedMotion() ?? false;
  const panelTransition = { duration: durationFor(reducedMotion, motionDurations.base), ease: [0.22, 1, 0.36, 1] as const };
  if (!alert) return <aside className="panel-frame protocol-panel">
    <Empty text="Select an alert to view its explanation and response protocol." />
    <h3>Sources</h3><p>Protocol sources are listed when a protocol is selected.</p>
    <p className="disclaimer">Decision support only, not medical advice.</p>
  </aside>;
  if (loading) return <motion.aside layoutId={`alert-${alert.id}`} className="panel-frame protocol-panel"
    initial={{ opacity: 0, x: reducedMotion ? 0 : 14 }} animate={{ opacity: 1, x: 0 }} transition={panelTransition}>
    <div className="loading-panel"><span className="spinner" />Loading protocol…</div>
    <h3>Sources</h3><p>Loading source details…</p><p className="disclaimer">Decision support only, not medical advice.</p>
  </motion.aside>;
  if (!protocol) return <motion.aside layoutId={`alert-${alert.id}`} className="panel-frame protocol-panel"
    initial={{ opacity: 0, x: reducedMotion ? 0 : 14 }} animate={{ opacity: 1, x: 0 }} transition={panelTransition}>
    <div className="error-banner" role="alert">{error || "No response protocol matches this alert."}</div>
    <h3>Sources</h3><p>No protocol source is available for this alert.</p>
    <p className="disclaimer">Decision support only, not medical advice.</p>
  </motion.aside>;
  return <motion.aside layoutId={`alert-${alert.id}`} className="panel-frame protocol-panel"
    initial={{ opacity: 0, x: reducedMotion ? 0 : 14 }} animate={{ opacity: 1, x: 0 }} transition={panelTransition}>
    <p className="section-kicker"><span />Guided response · Mission day {alert.day + 1}</p>
    <h2>{protocol.title}</h2>
    <span className={protocol.verified ? "verified-badge" : "draft-badge"}>
      {protocol.verified ? "VERIFIED" : "UNVERIFIED DRAFT"}
    </span>
    <div className={`tier-badge ${protocol.tier}`}>{protocol.tier.replace("_", " ")} tier</div>
    <div className="why-box"><strong>Why this was flagged</strong><p>{alert.explanation}</p></div>
    <h3>First steps</h3><ol>{protocol.non_drug_steps.map((step) => <li key={step}>{step}</li>)}</ol>
    {protocol.medication_category && <div className="medication"><strong>Medication category</strong>
      <p>{protocol.medication_category.class}</p><small>{protocol.medication_category.note}</small></div>}
    {protocol.tier === "escalate" && <p className="escalate-copy">Contact ground and follow the emergency procedure. No self-treatment medication guidance is provided.</p>}
    <h3>Escalate if</h3><ul>{protocol.escalate_if.map((item) => <li key={item}>{item}</li>)}</ul>
    <h3>Sources</h3><ul className="sources">{protocol.sources.map((source) => <li key={source.title}>{source.title}: {source.url}</li>)}</ul>
    <p className="disclaimer">{protocol.disclaimer}</p>
    <button type="button" className="button button-gold full" onClick={onAction}>Mark action taken</button>
  </motion.aside>;
}

function Empty({ text }: { text: string }) {
  return <div className="empty-state"><span aria-hidden="true">◌</span><p>{text}</p></div>;
}

export default App;
