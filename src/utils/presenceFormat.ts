/**
 * WhatsApp-style presence text: "Online" when active, otherwise a relative
 * "last seen ..." string, falling back gracefully when we don't have a
 * timestamp at all (e.g. a user who has never sent a heartbeat yet).
 */

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** e.g. "today at 3:45 PM", "yesterday at 9:02 AM", "on 14/03/2026" */
export function formatLastSeen(lastSeen?: string | null): string | null {
  if (!lastSeen) return null;
  const date = new Date(lastSeen);
  if (isNaN(date.getTime())) return null;

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  // Very recent — the online threshold already covers true "Online", this
  // just smooths over the few-second gap right as someone goes offline.
  if (diffMs < 60_000) return 'just now';

  if (isSameDay(date, now)) return `today at ${formatTime(date)}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return `yesterday at ${formatTime(date)}`;

  if (diffMs < 7 * 24 * 60 * 60 * 1000) {
    const weekday = date.toLocaleDateString([], { weekday: 'long' });
    return `on ${weekday} at ${formatTime(date)}`;
  }

  return `on ${date.toLocaleDateString([], { day: 'numeric', month: 'short', year: now.getFullYear() === date.getFullYear() ? undefined : 'numeric' })}`;
}

/** Full presence line: "Online" or "last seen <formatted>" or "Offline" */
export function presenceStatusText(isOnline?: boolean, lastSeen?: string | null): string {
  if (isOnline) return 'Online';
  const formatted = formatLastSeen(lastSeen);
  return formatted ? `last seen ${formatted}` : 'Offline';
}
