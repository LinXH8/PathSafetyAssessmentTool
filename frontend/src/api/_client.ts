/**
 * Shared HTTP client helpers used across all api/* domain modules.
 *
 * Keep this file minimal — only primitives that every module needs so there is
 * no risk of circular imports. Domain-specific fetch wrappers (e.g. autocode
 * network-error handling) live in their own module.
 */

/**
 * Extract a human-readable error string from a failed Response.
 * Prefers the `error` field in a JSON body; falls back to the raw text.
 */
export async function readError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    return j?.error || text;
  } catch {
    return text;
  }
}

/**
 * `fetch` with an abort-based timeout so a hung/unreachable backend can't leave a
 * request pending forever. On timeout it rejects with a readable `Error` (rather
 * than a bare `AbortError` DOMException). A caller-supplied `init.signal` is still
 * honoured — the request aborts when either that signal or the timeout fires.
 *
 * Use for quick reads/probes. Do NOT use for potentially long-running mutations
 * (e.g. project migrate/share copies) — the timeout would abort legitimate work.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 15000,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const callerSignal = init.signal ?? undefined;
  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    // Distinguish our timeout from a caller-initiated abort or a network error.
    if (timedOut) throw new Error(`Request timed out after ${timeoutMs} ms`);
    throw err;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}
