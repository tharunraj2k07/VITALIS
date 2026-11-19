import type { HealthAlert, MetricName, Protocol } from "./types.js";

type ProtocolTrigger = {
  any_metric?: MetricName[];
  min_severity?: "amber" | "red";
};

function severityAtLeast(actual: HealthAlert["severity"], minimum: ProtocolTrigger["min_severity"]): boolean {
  if (!minimum) return true;
  return minimum === "amber" || actual === "red";
}

export function matchProtocol(alert: HealthAlert, protocols: Protocol[]): Protocol | undefined {
  const matches = (protocol: Protocol) => {
    const trigger = protocol.trigger as ProtocolTrigger;
    const alertMetrics: MetricName[] = alert.relatedMetrics ?? [alert.metric];
    return (!trigger.any_metric || trigger.any_metric.some((metric) => alertMetrics.includes(metric)))
      && severityAtLeast(alert.severity, trigger.min_severity);
  };
  const urgent = alert.severity === "red"
    ? protocols.find((protocol) => protocol.id === "general-escalation" && matches(protocol))
    : undefined;
  const matching = urgent ?? protocols.find(matches);
  if (!matching) return undefined;
  return safeProtocol(matching);
}

export function safeProtocol(protocol: Protocol): Protocol {
  if (protocol.tier !== "escalate") return protocol;
  return { ...protocol, medication_category: null };
}
