type RetryOptions = {
  retries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
  onRetry?: (attempt: number) => void;
};

const waitForDelay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const retries = options.retries ?? 4;
  const maxDelayMs = options.maxDelayMs ?? 8_000;
  const wait = options.wait ?? waitForDelay;
  let delayMs = options.initialDelayMs ?? 1_000;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt > retries) throw error;
      options.onRetry?.(attempt + 1);
      await wait(delayMs);
      delayMs = Math.min(delayMs * 2, maxDelayMs);
    }
  }
}
