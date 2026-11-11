import { eq, sql } from "drizzle-orm";
import type { Queryable } from "~/db/types";
import { lessons } from "~/db/schema";
import { notifyLessonCreated } from "~/lib/notifications.server";

// ─── Lessons ───
// The one place lessons are created. Takes the database first, so tests can
// hand in an in-memory one, and runs in a transaction so the Notifications a
// new lesson triggers are written with it.

export type Lesson = typeof lessons.$inferSelect;

/**
 * Adds a lesson at the end of a module. When the module's course is
 * Published, every Student with a current Enrollment gets a `new_lesson`
 * Notification in the same transaction.
 */
export function createLesson(
  db: Queryable,
  actorId: number,
  moduleId: number,
  title: string,
  now: Date = new Date()
): Lesson {
  return db.transaction((tx) => {
    const last = tx
      .select({ max: sql<number>`coalesce(max(${lessons.position}), 0)` })
      .from(lessons)
      .where(eq(lessons.moduleId, moduleId))
      .get();
    const position = (last?.max ?? 0) + 1;

    const lesson = tx
      .insert(lessons)
      .values({ moduleId, title, position })
      .returning()
      .get();

    notifyLessonCreated(tx, lesson, actorId, now);
    return lesson;
  });
}
