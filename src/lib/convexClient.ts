import { ConvexReactClient } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

export { convex, api };

// ── Field mapping: Convex users table → UserProfile type ──

export type ConvexUser = {
  _id: Id<"users">;
  _creationTime: number;
  name?: string;
  image?: string;
  email?: string;
  isAnonymous?: boolean;
  role?: string;
};

import type { UserProfile } from "../types";

export function toUserProfile(u: ConvexUser): UserProfile {
  return {
    id: u._id,
    full_name: u.name ?? u.email?.split("@")[0] ?? "User",
    username: u.name?.toLowerCase().replace(/\s+/g, "") ?? undefined,
    email: u.email ?? "",
    avatar_url: u.image ?? undefined,
    is_online: false,
    last_seen: undefined,
  };
}

// ── Online threshold: 2 minutes ──
const ONLINE_THRESHOLD_MS = 120_000;
export function isOnline(lastActiveAt: number): boolean {
  return Date.now() - lastActiveAt < ONLINE_THRESHOLD_MS;
}

// ── Timestamp helpers ──
export function tsToIso(ts: number): string {
  return new Date(ts).toISOString();
}

export function isoToTs(iso: string): number {
  return new Date(iso).getTime();
}
