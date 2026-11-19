import { describe, expect, it, vi } from "vitest";
import { retryWithBackoff } from "./retry";

describe("mission server connection retries", () => {
  it("uses exponential delays and succeeds when the cold server wakes", async () => {
    let attempts = 0;
    const waits: number[] = [];
    const retryAttempts: number[] = [];
    const result = await retryWithBackoff(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("server starting");
      return ["crew-1"];
    }, {
      initialDelayMs: 250,
      wait: async (milliseconds) => { waits.push(milliseconds); },
      onRetry: (attempt) => retryAttempts.push(attempt),
    });

    expect(result).toEqual(["crew-1"]);
    expect(attempts).toBe(3);
    expect(waits).toEqual([250, 500]);
    expect(retryAttempts).toEqual([2, 3]);
  });

  it("surfaces the last error after the retry budget is exhausted", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("server unavailable"));
    await expect(retryWithBackoff(operation, {
      retries: 2,
      wait: async () => undefined,
    })).rejects.toThrow("server unavailable");
    expect(operation).toHaveBeenCalledTimes(3);
  });
});
