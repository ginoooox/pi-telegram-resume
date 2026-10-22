/**
 * Repeated-failure diagnostics fixtures
 * Zones: telegram diagnostics
 * Stands in for the logging domain's failure-run log wherever a test asserts raw per-failure recording.
 */

export interface TelegramPassthroughFailureLog {
  record: (error: unknown, details?: Record<string, unknown>) => void;
  settled: () => void;
  reset: () => void;
}

/** Faithful test double: records every failure without collapsing, so existing assertions stay exact. */
export function createPassthroughFailureLog(
  record: (error: unknown, details?: Record<string, unknown>) => void = () => {},
): TelegramPassthroughFailureLog {
  return { record, settled: () => {}, reset: () => {} };
}
