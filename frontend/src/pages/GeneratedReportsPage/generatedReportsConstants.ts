/**
 * Shared helpers for the Generated Reports page (container/shell architecture —
 * see temp/UI_V2_REDESIGN_GUIDE.md §3). Pure formatting utilities consumed by
 * both the v1 and v2 shells.
 */

/** Human-readable byte size, e.g. `1.2 MB`. */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

/** Locale date-time, e.g. `Jul 3, 2026, 14:20`. Falls back to the raw string. */
export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
