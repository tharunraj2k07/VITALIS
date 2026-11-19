import { describe, expect, it } from "vitest";
import { metricNames } from "./types.js";

describe("shared contracts", () => {
  it("defines the full metric set used by the simulator", () => {
    expect(metricNames).toHaveLength(12);
    expect(metricNames).toContain("radiation_dose_cumulative");
  });
});
