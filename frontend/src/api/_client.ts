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
