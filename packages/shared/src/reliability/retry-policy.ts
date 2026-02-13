export const DEFAULT_JOB_ATTEMPTS = 3;
export const DEFAULT_BACKOFF_BASE_MS = 500;
export const DEFAULT_BACKOFF_CAP_MS = 30_000;

export function computeBackoffMs(attempt: number): number {
  const normalizedAttempt = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1;
  const exponential = DEFAULT_BACKOFF_BASE_MS * 2 ** (normalizedAttempt - 1);
  const jitter = Math.floor(Math.random() * DEFAULT_BACKOFF_BASE_MS);
  return Math.min(DEFAULT_BACKOFF_CAP_MS, exponential + jitter);
}

export const DEFAULT_BULLMQ_JOB_OPTIONS = {
  attempts: DEFAULT_JOB_ATTEMPTS,
  backoff: {
    type: "exponential",
    delay: DEFAULT_BACKOFF_BASE_MS
  },
  removeOnComplete: 1000,
  removeOnFail: 5000
} as const;
