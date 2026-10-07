import {
  STEPS, CHOICE_STEPS, keys, cleanRoom, cleanSteps, cleanLevel, cleanLevels, parseRecord, storeOr503, instructorCheck, getRedis,
} from "../lib/store.js";

/**
 * Everything the instructor dashboard shows, for one room.
 *
 *   GET    /api/instructor?room=default   header: x-instructor-key: <INSTRUCTOR_KEY>
 *   DELETE /api/instructor?room=default   same header, empties that room
 *
 * The only endpoint that returns student data (names, emails, progress,
 * feedback), so it refuses every request without the key. With no key
 * configured on the site it refuses everything, rather than failing open.
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET" && req.method !== "DELETE") {
    res.setHeader("Allow", "GET, DELETE");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const check = instructorCheck(req);
  if (check === "unconfigured") {
    return res.status(503).json({
      ok: false,
      error: "instructor_key_unconfigured",
      message: "Set INSTRUCTOR_KEY in the Vercel project, then redeploy.",
    });
  }
  if (!check) {
    return res.status(401).json({ ok: false, error: "unauthorized", message: "That key isn't right." });
  }

  const db = storeOr503(res);
  if (!db) return;

  const room = cleanRoom(req.query?.room);

  /* Emptying a room throws away every student record and every piece of
     feedback in it, and there is no undo. Only the instructor key gets here. */
  if (req.method === "DELETE") {
    try {
      await Promise.all([db.del(keys.students(room)), db.del(keys.feedback(room))]);
      return res.status(200).json({ ok: true, room, cleared: true });
    } catch (err) {
      console.error("instructor reset failed", err);
      return res.status(500).json({ ok: false, error: "server_error", message: "Could not clear the room." });
    }
  }

  try {
    const [rawStudents, rawFeedback] = await Promise.all([
      db.hgetall(keys.students(room)),
      db.hgetall(keys.feedback(room)),
    ]);

    const students = Object.entries(rawStudents || {})
      .map(([id, raw]) => {
        const rec = parseRecord(raw);
        if (!rec) return null;
        const steps = cleanSteps(rec.steps);
        return {
          id,
          name: String(rec.name || id),
          email: rec.email || (id.includes("@") ? id : ""),
          steps,
          stepAt: rec.stepAt && typeof rec.stepAt === "object" ? rec.stepAt : {},
          level: cleanLevel(rec.level),
          levels: cleanLevels(rec.levels),
          doneCount: Object.keys(steps).length,
          feedbackAck: rec.feedbackAck === true,
          feedbackAckAt: rec.feedbackAckAt || null,
          joinedAt: rec.joinedAt || null,
          updatedAt: rec.updatedAt || null,
        };
      })
      .filter(Boolean);

    const feedback = Object.entries(rawFeedback || {})
      .map(([id, raw]) => {
        const rec = parseRecord(raw);
        if (!rec) return null;
        return {
          id,
          name: String(rec.name || id),
          email: rec.email || id,
          rating: Number(rec.rating) || null,
          comment: String(rec.comment || ""),
          at: rec.at || null,
        };
      })
      .filter(Boolean);

    return res.status(200).json({
      ok: true,
      room,
      steps: STEPS,
      choiceSteps: CHOICE_STEPS,
      now: new Date().toISOString(),
      rooms: await listRooms(),
      students,
      feedback,
    });
  } catch (err) {
    console.error("instructor handler failed", err);
    return res.status(500).json({ ok: false, error: "server_error", message: "Could not reach the database." });
  }
}

/** Room names that have any progress stored, for the dashboard's room picker. */
async function listRooms() {
  try {
    const db = getRedis();
    const found = new Set();
    let cursor = 0;
    for (let i = 0; i < 10; i++) {
      const [next, batch] = await db.scan(cursor, { match: "workshop:*:students", count: 200 });
      for (const key of batch) {
        const m = /^workshop:([^:]+):students$/.exec(key);
        if (m) found.add(m[1]);
      }
      cursor = Number(next);
      if (!cursor) break;
    }
    return [...found].sort();
  } catch {
    return [];
  }
}
