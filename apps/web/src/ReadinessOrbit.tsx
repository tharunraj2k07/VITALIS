import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { DomainScore } from "@vitalis/core";

export type OrbitStatus = "stable" | "amber" | "red";
export type OrbitMetric = { label: string; value: string; trend: string };

const orbitDomains: { id: DomainScore["domain"]; label: string; icon: string; radius: number }[] = [
  { id: "cardiovascular", label: "Cardiovascular", icon: "♥", radius: 116 },
  { id: "sleep_immune", label: "Sleep and immune", icon: "◒", radius: 96 },
  { id: "musculoskeletal", label: "Musculoskeletal", icon: "↗", radius: 76 },
  { id: "radiation", label: "Radiation", icon: "◉", radius: 56 },
  { id: "behavioral_cognitive", label: "Behavior and cognition", icon: "◎", radius: 36 },
];

const statusNames: Record<OrbitStatus, string> = {
  stable: "Tracking",
  amber: "Amber alert",
  red: "Red alert",
};

function orbitStatusColor(status: OrbitStatus): string {
  return status === "red" ? "var(--escalate)" : status === "amber" ? "var(--watch)" : "var(--aurora)";
}

export function ReadinessOrbit({
  scores,
  overall,
  statusByDomain = {},
  metricsByDomain = {},
  onSelectDomain,
  className = "",
}: {
  scores: DomainScore[];
  overall: number;
  statusByDomain?: Partial<Record<DomainScore["domain"], OrbitStatus>>;
  metricsByDomain?: Partial<Record<DomainScore["domain"], OrbitMetric>>;
  onSelectDomain?: (domain: DomainScore["domain"]) => void;
  className?: string;
}) {
  const [activeDomain, setActiveDomain] = useState<DomainScore["domain"] | null>(null);
  const reducedMotion = useReducedMotion();
  const selectedMetric = activeDomain ? metricsByDomain[activeDomain] : undefined;

  const activate = (domain: DomainScore["domain"]) => {
    setActiveDomain(domain);
    onSelectDomain?.(domain);
  };

  return (
    <div className={`orbit-composition ${className}`}>
      <svg className="readiness-orbit" viewBox="0 0 280 280" role="group"
        aria-label={`Readiness orbit. Overall readiness ${overall} out of 100.`}>
        <circle className="orbit-halo" cx="140" cy="140" r="128" />
        {orbitDomains.map((domain) => {
          const value = scores.find((item) => item.domain === domain.id)?.score ?? 0;
          const status = statusByDomain[domain.id] ?? "stable";
          return (
            <motion.g
              key={domain.id}
              layoutId={`domain-${domain.id}`}
              className={`orbit-ring orbit-ring-${status}`}
              role="button"
              tabIndex={0}
              aria-label={`${domain.label}: ${statusNames[status]}, score ${value} out of 100`}
              aria-describedby={activeDomain === domain.id && selectedMetric ? "orbit-detail" : undefined}
              data-domain={domain.id}
              data-score={value}
              onMouseEnter={() => setActiveDomain(domain.id)}
              onMouseLeave={() => setActiveDomain(null)}
              onFocus={() => setActiveDomain(domain.id)}
              onBlur={() => setActiveDomain(null)}
              onClick={() => activate(domain.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  activate(domain.id);
                }
              }}
            >
              <circle className="orbit-track" cx="140" cy="140" r={domain.radius} />
              <motion.circle
                className="orbit-progress"
                cx="140"
                cy="140"
                r={domain.radius}
                pathLength={1}
                initial={false}
                animate={{ pathLength: value / 100, stroke: orbitStatusColor(status) }}
                transition={{ duration: reducedMotion ? 0 : 0.8, ease: [0.22, 1, 0.36, 1] }}
              />
              <title>{`${domain.label}: ${statusNames[status]}, ${value} out of 100`}</title>
            </motion.g>
          );
        })}
        <circle className="orbit-center" cx="140" cy="140" r="27" />
        <text className="orbit-center-score" x="140" y="139" textAnchor="middle">{overall}</text>
        <text className="orbit-center-label" x="140" y="156" textAnchor="middle">READY</text>
      </svg>
      <ul className="orbit-domain-list" aria-label="Readiness domains">
        {orbitDomains.map((domain) => {
          const score = scores.find((item) => item.domain === domain.id)?.score ?? 0;
          const status = statusByDomain[domain.id] ?? "stable";
          return (
            <li className={`orbit-domain orbit-domain-${status}`} key={domain.id}
              aria-label={`${domain.label}: ${statusNames[status]}, score ${score} out of 100`}>
              <span className="orbit-domain-icon" aria-hidden="true">{status === "red" ? "!" : status === "amber" ? "◷" : "✓"}</span>
              <span>{domain.label}</span>
              <span className="orbit-domain-score">{score}</span>
              <span className="orbit-domain-status">{statusNames[status]}</span>
            </li>
          );
        })}
      </ul>
      <div className="orbit-detail" id="orbit-detail" role="status" aria-live="polite">
        {activeDomain ? (
          <>
            <strong>{orbitDomains.find((item) => item.id === activeDomain)?.label}</strong>
            {selectedMetric
              ? <span>{selectedMetric.label}: {selectedMetric.value} · {selectedMetric.trend}</span>
              : <span>{statusNames[statusByDomain[activeDomain] ?? "stable"]}</span>}
          </>
        ) : <span>Focus or select a ring to inspect its latest metric and trend.</span>}
      </div>
    </div>
  );
}
