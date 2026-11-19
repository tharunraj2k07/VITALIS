import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { calculateBaselines, calculateDomainScores, simulateMission } from "@vitalis/core";
import { describe, expect, it } from "vitest";
import { ReadinessOrbit } from "./ReadinessOrbit";

describe("readiness orbit", () => {
  it("renders the score values returned by core domain scoring", () => {
    const observations = simulateMission({ crewId: "orbit-test", seed: 101, days: 180 });
    const baselines = calculateBaselines(observations);
    const latest = observations[observations.length - 1];
    if (!latest) throw new Error("The deterministic test mission has no observations.");
    const scores = calculateDomainScores(latest, baselines);
    const overall = Math.round(scores.reduce((total, item) => total + item.score, 0) / scores.length);
    const markup = renderToStaticMarkup(<ReadinessOrbit scores={scores} overall={overall} />);

    expect(markup).toContain(`Overall readiness ${overall} out of 100`);
    for (const score of scores) {
      expect(markup).toContain(`data-domain="${score.domain}"`);
      expect(markup).toContain(`data-score="${score.score}"`);
      expect(markup).toContain(`${score.score} out of 100`);
    }
  });
});
