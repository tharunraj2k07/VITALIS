import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MissionStatus from "./MissionStatus";

describe("mission communications status", () => {
  it("announces link loss and the pending sync count", () => {
    const markup = renderToStaticMarkup(<MissionStatus online={false} linkEnabled={true}
      queueCount={2} lastSyncedAt="2026-11-15T10:00:00.000Z" connecting={false} onToggle={() => undefined} />);
    expect(markup).toContain("Ground link lost");
    expect(markup).toContain("2 items are queued for sync");
    expect(markup).toContain("Last sync");
    expect(markup).toContain("Decision support only, not medical advice.");
  });

  it("shows a clear stable connection state", () => {
    const markup = renderToStaticMarkup(<MissionStatus online={true} linkEnabled={true}
      queueCount={0} lastSyncedAt={null} connecting={false} onToggle={() => undefined} />);
    expect(markup).toContain("Ground link stable");
    expect(markup).toContain("aria-pressed=\"true\"");
  });
});
