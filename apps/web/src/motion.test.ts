import { describe, expect, it } from "vitest";
import { durationFor, motionDurations } from "./motion";

describe("reduced motion policy", () => {
  it("removes non-essential transition duration when reduced motion is requested", () => {
    expect(durationFor(true, motionDurations.route)).toBe(0);
    expect(durationFor(true, motionDurations.settle)).toBe(0);
    expect(durationFor(false, motionDurations.route)).toBeLessThan(0.4);
  });
});
