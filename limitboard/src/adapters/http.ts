// Shared HTTP error for adapters: carries the status and the server's
// Retry-After so the poll loop can honor server-mandated cooldowns. Observed
// on api.anthropic.com/api/oauth/usage: 429 with Retry-After ≈ 47min — far
// beyond the formula backoff cap, and retrying earlier restarts the penalty.
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Build an HttpError from a failed Response, parsing Retry-After (delta-seconds or HTTP-date). */
export function httpError(context: string, res: Response): HttpError {
  let retryAfterMs: number | undefined;
  const ra = res.headers.get("retry-after");
  if (ra) {
    const secs = Number(ra);
    const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(ra) - Date.now();
    if (Number.isFinite(ms) && ms > 0) retryAfterMs = ms;
  }
  const hint =
    retryAfterMs != null
      ? ` · retry in ~${Math.ceil(retryAfterMs / 60_000)}m`
      : "";
  return new HttpError(
    `${context} → HTTP ${res.status}${hint}`,
    res.status,
    retryAfterMs,
  );
}
