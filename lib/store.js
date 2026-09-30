import { Redis } from "@upstash/redis";
import { timingSafeEqual } from "node:crypto";

/**
 * Shared storage and validation for the workshop API.
 *
 * One Redis hash per room for progress and one for feedback, both keyed by
 * the student's email. Both expire on their own, so old workshops clean
 * themselves up.
 */

export const STEPS = [
  "overview", "prep", "folder", "base", "agents", "restart",
  "me", "r1", "r2", "r3", "r4", "debrief",
];

export const LEVELS = ["beginner", "intermediate", "advanced"];
export const MAX_STUDENTS = 300;
export const MAX_NAME = 60;
export const MAX_EMAIL = 120;
export const MAX_COMMENT = 2000;
export const ROOM_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let redis = null;

export function getRedis() {
  if (!redis) redis = Redis.fromEnv();
  return redis;
}

export const keys = {
  students: (room) => `workshop:${room}:students`,
  feedback: (room) => `workshop:${room}:feedback`,
};

export function cleanRoom(value) {
  const room = String(value || "default")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40);
  return room || "default";
}

export function cleanName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, MAX_NAME);
}

/** A lowercased email, or "" if it doesn't look like one. */
export function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase().slice(0, MAX_EMAIL);
  return EMAIL_RE.test(email) ? email : "";
}

/** A known level name, or the default. */
export function cleanLevel(value) {
  return LEVELS.indexOf(String(value)) >= 0 ? String(value) : "beginner";
}

/** Which level a student used for each step, for known steps only. */
export function cleanLevels(input) {
  const out = {};
  if (input && typeof input === "object") {
    for (const step of STEPS) if (LEVELS.indexOf(input[step]) >= 0) out[step] = input[step];
  }
  return out;
}

/** Keep only the step flags we know about, as real booleans. */
export function cleanSteps(input) {
  const out = {};
  if (input && typeof input === "object") {
    for (const step of STEPS) if (input[step] === true) out[step] = true;
  }
  return out;
}

/** Upstash deserializes JSON on read; older writes may still be strings. */
export function parseRecord(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function readBody(req) {
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}");
    } catch {
      return {};
    }
  }
  return req.body && typeof req.body === "object" ? req.body : {};
}

/** The Redis client, or null after answering 503 when no store is connected. */
export function storeOr503(res) {
  try {
    return getRedis();
  } catch {
    res.status(503).json({
      ok: false,
      error: "storage_unconfigured",
      message: "No database is connected yet. Run: vercel integration add upstash",
    });
    return null;
  }
}

/**
 * Whether the request carries the instructor key. Returns "unconfigured" when
 * the site has no key set, so the dashboard can say so instead of failing open.
 */
export function instructorCheck(req) {
  const expected = process.env.INSTRUCTOR_KEY || "";
  if (!expected) return "unconfigured";
  const given = Buffer.from(String(req.headers["x-instructor-key"] || ""));
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** Refuse a new entry once a room's hash is full; existing entries always pass. */
export async function roomHasSpace(db, key, id) {
  if (await db.hexists(key, id)) return true;
  return (await db.hlen(key)) < MAX_STUDENTS;
}
