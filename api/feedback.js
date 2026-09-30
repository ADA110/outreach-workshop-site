import {
  ROOM_TTL_SECONDS, MAX_COMMENT, keys, cleanRoom, cleanName, cleanEmail,
  parseRecord, readBody, storeOr503, roomHasSpace,
} from "../lib/store.js";

/**
 * A student rates the workshop. Sending again replaces their earlier feedback.
 *
 *   POST /api/feedback?room=default   body: { name, email, rating: 1-5, comment }
 *
 * Write-only; the instructor reads feedback through /api/instructor.
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const db = storeOr503(res);
  if (!db) return;

  const room = cleanRoom(req.query?.room);
  const body = readBody(req);
  const name = cleanName(body.name);
  const email = cleanEmail(body.email);
  const rating = Number(body.rating);
  const comment = String(body.comment || "").trim().slice(0, MAX_COMMENT);

  if (!name || !email) {
    return res.status(400).json({ ok: false, error: "bad_student", message: "Name and email are required." });
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ ok: false, error: "bad_rating", message: "Rating must be a whole number from 1 to 5." });
  }

  try {
    const key = keys.feedback(room);

    if (!(await roomHasSpace(db, key, email))) {
      return res.status(429).json({ ok: false, error: "room_full", message: "This room is full." });
    }

    const prev = parseRecord(await db.hget(key, email)) || {};
    const now = new Date().toISOString();

    const record = {
      name,
      email,
      rating,
      comment,
      firstAt: prev.firstAt || now,
      at: now,
    };

    await db.hset(key, { [email]: JSON.stringify(record) });
    await db.expire(key, ROOM_TTL_SECONDS);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("feedback handler failed", err);
    return res.status(500).json({ ok: false, error: "server_error", message: "Could not reach the database." });
  }
}
