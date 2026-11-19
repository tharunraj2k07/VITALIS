import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  calculateBaselines, calculateDomainScores, detectAlerts, metricDomains, simulateMission,
} from "@vitalis/core";
import type { DomainScore, MetricName } from "@vitalis/core";
import { ReadinessOrbit, type OrbitMetric, type OrbitStatus } from "./ReadinessOrbit";

const storySteps = [
  {
    title: "Build a personal reference",
    body: "A short preflight window establishes a synthetic baseline for each crew member and metric.",
    label: "Personal baseline",
  },
  {
    title: "Notice a change",
    body: "Subsequent readings are compared with that individual's reference using the documented drift methods.",
    label: "Drift detected",
  },
  {
    title: "Explain the flag",
    body: "Each explanation says what changed, versus whose baseline, and across which mission days.",
    label: "Why it was flagged",
  },
  {
    title: "Review a guided response",
    body: "A matched protocol draft organizes response steps and escalation conditions for qualified review.",
    label: "Guided response",
  },
];

const metricLabels: Record<MetricName, { label: string; unit: string }> = {
  resting_hr: { label: "Resting heart rate", unit: "bpm" },
  systolic_bp: { label: "Systolic blood pressure", unit: "mmHg" },
  diastolic_bp: { label: "Diastolic blood pressure", unit: "mmHg" },
  spo2: { label: "Blood oxygen saturation", unit: "%" },
  skin_temp: { label: "Skin temperature", unit: "°C" },
  sleep_hours: { label: "Sleep duration", unit: "hours" },
  sleep_efficiency: { label: "Sleep efficiency", unit: "%" },
  exercise_minutes: { label: "Exercise", unit: "min" },
  radiation_dose_cumulative: { label: "Cumulative radiation dose", unit: "units" },
  mood: { label: "Mood", unit: "/10" },
  congestion: { label: "Congestion", unit: "/10" },
  reaction_time: { label: "Reaction time", unit: "s" },
};

const preferredMetrics: Record<DomainScore["domain"], MetricName> = {
  cardiovascular: "resting_hr",
  sleep_immune: "sleep_hours",
  musculoskeletal: "exercise_minutes",
  radiation: "radiation_dose_cumulative",
  behavioral_cognitive: "mood",
};

function buildPreview() {
  const observations = simulateMission({ crewId: "story-preview", seed: 100, days: 180 });
  const baselines = calculateBaselines(observations);
  const latest = observations[observations.length - 1];
  const scores = latest ? calculateDomainScores(latest, baselines) : [];
  const alerts = detectAlerts(observations, baselines).filter((alert) => alert.day === latest?.day);
  const overall = scores.length
    ? Math.round(scores.reduce((total, item) => total + item.score, 0) / scores.length)
    : 0;
  const statusByDomain: Partial<Record<DomainScore["domain"], OrbitStatus>> = {};
  for (const alert of alerts) {
    const domain = metricDomains[alert.metric];
    if (alert.severity === "red" || statusByDomain[domain] !== "red") {
      statusByDomain[domain] = alert.severity;
    }
  }
  const baselineByMetric = new Map(baselines.map((item) => [item.metric, item]));
  const metricsByDomain: Partial<Record<DomainScore["domain"], OrbitMetric>> = {};
  for (const [domain, metric] of Object.entries(preferredMetrics) as [DomainScore["domain"], MetricName][]) {
    const current = latest?.metrics[metric];
    const baseline = baselineByMetric.get(metric);
    if (current === undefined || !baseline) continue;
    const zScore = (current - baseline.mean) / (baseline.std > 0 ? baseline.std : 1);
    metricsByDomain[domain] = {
      label: metricLabels[metric].label,
      value: `${current} ${metricLabels[metric].unit}`,
      trend: `${Math.abs(zScore).toFixed(1)} standard deviations from baseline`,
    };
  }
  return { scores, overall, statusByDomain, metricsByDomain };
}

export default function StoryPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const preview = useMemo(() => buildPreview(), []);
  const [activeStep, setActiveStep] = useState(0);
  const processRef = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const root = processRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setActiveStep(Number((entry.target as HTMLElement).dataset.stepIndex));
        }
      }
    }, { rootMargin: "-34% 0px -42% 0px", threshold: 0 });
    root.querySelectorAll<HTMLElement>("[data-step-index]").forEach((step) => observer.observe(step));
    return () => observer.disconnect();
  }, []);

  const enterMission = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onNavigate("/mission");
  };

  const exploreStory = () => document.getElementById("the-approach")?.scrollIntoView({
    behavior: reducedMotion ? "instant" : "smooth",
  });

  return (
    <div className="story-page">
      <header className="story-nav">
        <a className="brand-lockup" href="/" aria-label="VITALIS home">
          <span className="brand-sigil" aria-hidden="true">V</span>
          <span>VITALIS<small>Mission health observatory</small></span>
        </a>
        <nav aria-label="Story navigation">
          <a href="#the-approach">Our approach</a>
          <a href="#safety">Safety</a>
          <a className="button button-outline" href="/mission" onClick={enterMission}>Enter mission control</a>
        </nav>
      </header>

      <main>
        <section className="story-hero" aria-labelledby="story-title">
          <div className="hero-copy">
            <p className="section-kicker"><span /> A personal-baseline prototype</p>
            <motion.h1 id="story-title" initial={{ opacity: 0, y: reducedMotion ? 0 : 14 }}
              animate={{ opacity: 1, y: 0 }} transition={{ duration: reducedMotion ? 0 : 0.7, delay: 0.12 }}>
              Far from Earth,<br />crews monitor themselves.
            </motion.h1>
            <p className="hero-deck">VITALIS makes meaningful changes in an astronaut’s own health pattern easier to see, understand, and review.</p>
            <div className="hero-actions">
              <button type="button" className="button button-gold" onClick={exploreStory}>Explore the approach</button>
              <a className="text-link" href="/mission" onClick={enterMission}>Enter mission control <span aria-hidden="true">↗</span></a>
            </div>
            <p className="hero-note">Simulated data · Decision support only · Unverified drafts</p>
          </div>
          <div className="hero-orbit-frame">
            <div className="orbit-heading">
              <span>Illustrative mission</span>
              <span>Day 180 / 180</span>
            </div>
            <ReadinessOrbit {...preview} className="orbit-story" />
            <p className="orbit-caption">A simulated readiness view, compared with individual baselines.</p>
          </div>
        </section>

        <section className="delay-scene" aria-labelledby="delay-title">
          <div className="scene-index">01 <span>Distance and delay</span></div>
          <div className="delay-copy">
            <p className="section-kicker">The challenge</p>
            <h2 id="delay-title">A crew cannot always wait for a conversation with ground.</h2>
            <p>On a long mission, communication delay means there is no real-time ground doctor. Crew members need a way to notice changes in themselves and communicate what changed.</p>
          </div>
          <div className="delay-illustration" aria-label="An illustrated signal path from a spacecraft to Earth">
            <span className="signal-point signal-crew">Crew</span>
            <span className="signal-line"><i /><i /><i /></span>
            <span className="signal-point signal-earth">Ground</span>
            <p>Communication delay</p>
          </div>
        </section>

        <section className="process-section" id="the-approach" ref={processRef} aria-labelledby="process-title">
          <div className="process-intro">
            <p className="section-kicker">A clear sequence</p>
            <h2 id="process-title">A personal reference makes the change easier to explain.</h2>
          </div>
          <div className="process-grid">
            <aside className="process-visual" aria-label={`Step ${activeStep + 1}: ${storySteps[activeStep].label}`}>
              <span className="process-count">0{activeStep + 1} / 04</span>
              <div className={`process-glyph process-glyph-${activeStep}`} aria-hidden="true">
                <span /><span /><span />
              </div>
              <p>{storySteps[activeStep].label}</p>
              <div className="process-progress" aria-hidden="true">
                <motion.span animate={{ scaleX: (activeStep + 1) / storySteps.length }}
                  transition={{ duration: reducedMotion ? 0 : 0.25 }} />
              </div>
            </aside>
            <div className="process-steps">
              {storySteps.map((step, index) => (
                <article className={`story-step ${activeStep === index ? "is-current" : ""}`}
                  key={step.label} data-step-index={index} aria-current={activeStep === index ? "step" : undefined}>
                  <span className="step-number">0{index + 1}</span>
                  <div><h3>{step.title}</h3><p>{step.body}</p></div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="safety-scene" id="safety" aria-labelledby="safety-title">
          <div className="scene-index">02 <span>Offline and safety</span></div>
          <div className="safety-copy">
            <p className="section-kicker">Built for a lost link</p>
            <h2 id="safety-title">Useful locally. Clear about its limits.</h2>
            <p>When the link is unavailable, the prototype can calculate locally and queue check-ins for sync. It uses simulated observations and unverified protocol drafts.</p>
          </div>
          <div className="safety-rails">
            <div><span className="rail-icon" aria-hidden="true">↻</span><strong>Offline-first</strong><p>Local mission data, scoring, and protocol matching continue without the API.</p></div>
            <div><span className="rail-icon" aria-hidden="true">i</span><strong>Decision support only</strong><p>Not medical advice, diagnosis, or a substitute for an onboard procedure.</p></div>
            <div><span className="rail-icon" aria-hidden="true">◇</span><strong>Unverified drafts</strong><p>Every starter protocol remains a draft until the team verifies its sources.</p></div>
          </div>
          <a className="button button-gold safety-cta" href="/mission" onClick={enterMission}>Enter mission control</a>
        </section>
      </main>

      <footer className="story-footer">
        <span>VITALIS · Simulated mission health</span>
        <span>Decision support only, not medical advice.</span>
      </footer>
    </div>
  );
}
