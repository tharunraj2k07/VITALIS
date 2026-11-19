import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import protocolData from "../../../data/protocols.json";
import type { HealthAlert, Protocol } from "@vitalis/core";
import { ProtocolPanel } from "./App";

const alert: HealthAlert = {
  id: "alert-1",
  crewId: "crew-1",
  day: 20,
  metric: "systolic_bp",
  severity: "amber",
  status: "open",
  value: 130,
  baselineMean: 110,
  baselineStd: 3,
  zScore: 2.4,
  explanation: "On mission day 21, the reading changed from this crew member's preflight baseline.",
};

describe("protocol panel safety and content", () => {
  const protocols = protocolData as Protocol[];

  it("renders the unverified draft badge for every unverified protocol", () => {
    const unverified = protocols.filter((protocol) => !protocol.verified);
    expect(unverified.length).toBeGreaterThan(0);
    for (const protocol of unverified) {
      const markup = renderToStaticMarkup(<ProtocolPanel
        protocol={protocol}
        alert={alert}
        loading={false}
        error=""
        onAction={() => undefined}
      />);
      expect(markup).toContain("UNVERIFIED DRAFT");
    }
  });

  it("keeps the protocol section order, sources, and safety disclaimer visible", () => {
    const markup = renderToStaticMarkup(<ProtocolPanel
      protocol={protocols[0]}
      alert={alert}
      loading={false}
      error=""
      onAction={() => undefined}
    />);
    expect(markup.indexOf("First steps")).toBeLessThan(markup.indexOf("Sources"));
    expect(markup).toContain("Decision support only, not medical advice.");
    expect(markup).toContain("TODO: NASA/ISS public medical reference");
  });

  it("keeps the safety disclaimer visible when no alert is selected", () => {
    const markup = renderToStaticMarkup(<ProtocolPanel
      protocol={null}
      loading={false}
      error=""
      onAction={() => undefined}
    />);
    expect(markup).toContain("Decision support only, not medical advice.");
  });

  it("shows a verified label only when the protocol flag is true", () => {
    const markup = renderToStaticMarkup(<ProtocolPanel
      protocol={{ ...protocols[0], verified: true }}
      alert={alert}
      loading={false}
      error=""
      onAction={() => undefined}
    />);
    expect(markup).toContain(">VERIFIED</span>");
    expect(markup).not.toContain("UNVERIFIED DRAFT");
  });
});
