/* eslint-disable react-refresh/only-export-components */
import "@fontsource-variable/fraunces";
import "@fontsource-variable/manrope";
import React, { lazy, Suspense, useCallback, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import LaunchSequence from "./LaunchSequence";
import Starfield from "./Starfield";
import { navigate } from "./navigation";
import "./styles.css";

const StoryPage = lazy(() => import("./StoryPage"));
const MissionControl = lazy(() => import("./App"));

function AppRouter() {
  const [path, setPath] = useState(window.location.pathname === "/mission" ? "/mission" : "/");
  const reducedMotion = useReducedMotion();
  const [showOpening, setShowOpening] = useState(() => {
    if (sessionStorage.getItem("vitalis-opening-seen") || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    sessionStorage.setItem("vitalis-opening-seen", "true");
    return true;
  });
  const finishOpening = useCallback(() => setShowOpening(false), []);

  useEffect(() => {
    const updatePath = () => setPath(window.location.pathname === "/mission" ? "/mission" : "/");
    window.addEventListener("popstate", updatePath);
    return () => window.removeEventListener("popstate", updatePath);
  }, []);

  useEffect(() => {
    document.title = path === "/mission" ? "Mission control | VITALIS" : "VITALIS | Personal mission health";
  }, [path]);

  return (
    <div className="experience-shell">
      <Starfield />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={path} className="route-stage"
          initial={{ opacity: 0, y: reducedMotion ? 0 : 7 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reducedMotion ? 0 : -5 }}
          transition={{ duration: reducedMotion ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}>
          <Suspense fallback={<div className="route-loading" role="status">Opening the observatory…</div>}>
            {path === "/mission"
              ? <MissionControl onNavigate={navigate} />
              : <StoryPage onNavigate={navigate} />}
          </Suspense>
        </motion.div>
      </AnimatePresence>
      <AnimatePresence>
        {showOpening && <LaunchSequence onComplete={finishOpening} />}
      </AnimatePresence>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><AppRouter /></React.StrictMode>,
);
