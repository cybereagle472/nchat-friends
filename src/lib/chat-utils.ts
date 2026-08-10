export type NamedUser = {
  name?: string | null;
  email?: string | null;
  isAnonymous?: boolean;
};

/** The name we show for a user — display name, else email local part. */
export function displayName(u: NamedUser | null | undefined): string {
  if (!u) return "Friend";
  if (u.name && u.name.trim()) return u.name.trim();
  if (u.email && u.email.includes("@")) return u.email.split("@")[0];
  return "Guest";
}

/** Uppercase initials for an avatar fallback. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

/** Deterministic cool-toned gradient for an avatar, with a couple of warm
 *  playful pops so circles of friends stay visually distinct. */
const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #38bdf8, #2563eb)",
  "linear-gradient(135deg, #818cf8, #6d28d9)",
  "linear-gradient(135deg, #22d3ee, #0ea5e9)",
  "linear-gradient(135deg, #34d399, #0d9488)",
  "linear-gradient(135deg, #a78bfa, #7c3aed)",
  "linear-gradient(135deg, #f472b6, #e11d48)",
  "linear-gradient(135deg, #fbbf24, #f97316)",
  "linear-gradient(135deg, #60a5fa, #4f46e5)",
  "linear-gradient(135deg, #2dd4bf, #0e7490)",
];

export function avatarGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

/** Group avatar: uses a fixed gradient seeded by the group id. */
export function groupGradient(seed: string): string {
  return avatarGradient("group:" + seed);
}

export function formatMessageTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatConversationTime(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return formatMessageTime(ts);

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) return "Yesterday";

  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return date.toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDayLabel(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfDay) / 86400000);
  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  return date.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function formatCallDuration(startedAt: number, now = Date.now()): string {
  const total = Math.max(0, Math.floor((now - startedAt) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function truncate(text: string, max = 60): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}
