import { useEffect } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { durationFor, motionDurations } from "./motion";

export default function AnimatedValue({ value, className = "" }: { value: number; className?: string }) {
  const reducedMotion = useReducedMotion() ?? false;
  const count = useMotionValue(value);
  const label = useTransform(count, (current) => String(Math.round(current)));

  useEffect(() => {
    const controls = animate(count, value, {
      duration: durationFor(reducedMotion, motionDurations.settle),
      ease: [0.22, 1, 0.36, 1],
    });
    return () => controls.stop();
  }, [count, reducedMotion, value]);

  return <motion.span className={className}>{label}</motion.span>;
}
