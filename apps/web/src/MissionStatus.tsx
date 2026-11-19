import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { durationFor, motionDurations } from "./motion";

export default function MissionStatus({
  online,
  linkEnabled,
  queueCount,
  lastSyncedAt,
  connecting,
  onToggle,
}: {
  online: boolean;
  linkEnabled: boolean;
  queueCount: number;
  lastSyncedAt: string | null;
  connecting: boolean;
  onToggle: () => void;
}) {
  const reducedMotion = useReducedMotion() ?? false;
  const connected = online && linkEnabled;
  const lastSyncLabel = lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString() : "Not synced";

  return (
    <>
      <div className={`mission-status ${connected ? "" : "is-offline"}`} data-testid="mission-status">
        <button type="button" className={`connection-control ${connected ? "" : "is-offline"}`}
          onClick={onToggle} disabled={connecting} aria-pressed={connected} aria-label="Toggle mission communications link">
          <span className="connection-dot" aria-hidden="true" />
          {connecting ? "Connecting" : connected ? "Online" : "Offline"}
        </button>
        <span className="link-label">{connected ? "Ground link stable" : "Ground link lost"}</span>
        <span className="sync-readout" aria-live="polite">
          Queue
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.strong key={queueCount} initial={{ opacity: 0, y: reducedMotion ? 0 : -5 }}
              animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reducedMotion ? 0 : 5 }}
              transition={{ duration: durationFor(reducedMotion, motionDurations.fast) }}>
              {queueCount}
            </motion.strong>
          </AnimatePresence>
          <small>Last sync {lastSyncLabel}</small>
        </span>
        <strong>Decision support only, not medical advice.</strong>
      </div>
      {!connected && (
        <div className="network-banner" role="status" aria-live="polite">
          <span>Ground link lost. Local scoring and protocol matching remain available. {queueCount} {queueCount === 1 ? "item is" : "items are"} queued for sync.</span>
          <button type="button" onClick={onToggle} disabled={connecting}>
            {connecting ? "Reconnecting" : "Retry connection"}
          </button>
        </div>
      )}
    </>
  );
}
