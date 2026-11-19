import { useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";

export default function LaunchSequence({ onComplete }: { onComplete: () => void }) {
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      onComplete();
      return;
    }
    const timer = window.setTimeout(onComplete, 2_100);
    return () => window.clearTimeout(timer);
  }, [onComplete, reducedMotion]);

  if (reducedMotion) return null;

  return (
    <motion.div className="launch-sequence" role="status" aria-label="VITALIS observatory opening"
      initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 0.45, delay: 1.65 }}>
      <svg className="launch-sequence-mark" viewBox="0 0 100 100" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((index) => (
          <motion.circle key={index} cx="50" cy="50" r={42 - index * 7}
            fill="none" stroke={index === 0 ? "var(--gold)" : "var(--aurora)"}
            strokeWidth="1.5" pathLength={1}
            initial={{ pathLength: 0, opacity: 0.25 }}
            animate={{ pathLength: 0.78 - index * 0.04, opacity: 1 }}
            transition={{ duration: 1.05, delay: 0.15 + index * 0.12 }} />
        ))}
        <motion.text x="50" y="55" textAnchor="middle" className="launch-score"
          initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.9 }}>73</motion.text>
      </svg>
      <span>VITALIS · MISSION HEALTH</span>
      <button type="button" onClick={onComplete}>Skip intro</button>
    </motion.div>
  );
}
