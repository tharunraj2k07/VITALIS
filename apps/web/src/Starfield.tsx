import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";

type Star = { x: number; y: number; radius: number; phase: number; gold: boolean };

export default function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    let width = 0;
    let height = 0;
    let frame = 0;
    let pointerX = 0;
    let pointerY = 0;
    const stars: Star[] = [];
    let seed = 41;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = Math.min(140, Math.max(48, Math.round(width * height / 10_000)));
      stars.splice(0, stars.length, ...Array.from({ length: count }, () => ({
        x: random() * width,
        y: random() * height,
        radius: random() * 1.15 + 0.25,
        phase: random() * Math.PI * 2,
        gold: random() > 0.87,
      })));
      draw(0);
    };

    const draw = (time: number) => {
      context.clearRect(0, 0, width, height);
      for (const star of stars) {
        const shimmer = reducedMotion ? 0.66 : 0.42 + (Math.sin(time * 0.00055 + star.phase) + 1) * 0.2;
        const x = star.x + pointerX * star.radius * 1.2;
        const y = star.y + pointerY * star.radius * 1.2;
        context.beginPath();
        context.arc(x, y, star.radius, 0, Math.PI * 2);
        context.fillStyle = star.gold
          ? `rgba(201, 162, 75, ${shimmer})`
          : `rgba(222, 230, 250, ${shimmer})`;
        context.fill();
      }
    };

    const animate = (time: number) => {
      if (document.visibilityState === "visible" && !reducedMotion) {
        draw(time);
        frame = window.requestAnimationFrame(animate);
      }
    };
    const onVisibilityChange = () => {
      window.cancelAnimationFrame(frame);
      if (document.visibilityState === "visible" && !reducedMotion) {
        frame = window.requestAnimationFrame(animate);
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      pointerX = (event.clientX / Math.max(width, 1) - 0.5) * 2;
      pointerY = (event.clientY / Math.max(height, 1) - 0.5) * 2;
      if (reducedMotion) draw(0);
    };

    resize();
    if (!reducedMotion && document.visibilityState === "visible") {
      frame = window.requestAnimationFrame(animate);
    }
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [reducedMotion]);

  return <canvas className="starfield" ref={canvasRef} aria-hidden="true" />;
}
