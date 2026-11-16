/**
 * Pure break-timer math. Always derived from the persisted break start
 * timestamp — never from a client-side counter — so refreshes, navigation,
 * tab sleep and clock changes cannot reset or corrupt the value.
 */
export interface BreakCountdown {
  elapsedSeconds: number;
  allowanceSeconds: number;
  /** Seconds left inside the allowance (0 once exceeded). */
  remainingSeconds: number;
  /** Seconds beyond the allowance (0 while inside it). */
  overSeconds: number;
  exceeded: boolean;
}

export function breakCountdown(
  startAt: string,
  nowMs: number,
  allowanceMinutes: number
): BreakCountdown {
  const allowanceSeconds = Math.max(0, allowanceMinutes) * 60;
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - new Date(startAt).getTime()) / 1000));
  const exceeded = elapsedSeconds > allowanceSeconds;
  return {
    elapsedSeconds,
    allowanceSeconds,
    remainingSeconds: exceeded ? 0 : allowanceSeconds - elapsedSeconds,
    overSeconds: exceeded ? elapsedSeconds - allowanceSeconds : 0,
    exceeded,
  };
}
