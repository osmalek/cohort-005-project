import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { comments, courses, lessons, modules } from "~/db/schema";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";

// ─── Comments ───
// The one place comments are written: a Student or Instructor commenting on
// the lesson page, and an Instructor replying from the Questions inbox.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Writes run in a transaction so side effects of a new comment (such as
// Notifications) can join the same write.

export type Db = BetterSQLite3Database<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Queryable = Db | Tx;

export type Comment = typeof comments.$inferSelect;

/** Trims a comment body and checks it is 1–5000 characters. */
export function assertValidCommentBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length < MIN_COMMENT_LENGTH) {
    throw new Error("Comment cannot be empty");
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new Error(
      `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`
    );
  }
  return trimmed;
}

function lessonExists(db: Queryable, lessonId: number): boolean {
  const row = db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessons.id, lessonId))
    .get();
  return row !== undefined;
}

/**
 * Writes a comment on a lesson. `parentId` null makes a top-level comment;
 * otherwise it is a reply, and its parent must be a top-level comment on the
 * same lesson (replies are one level deep). Throws an Error with a
 * user-facing message when the comment is not allowed.
 */
export function createComment(
  db: Queryable,
  userId: number,
  lessonId: number,
  parentId: number | null,
  body: string
): Comment {
  const trimmed = assertValidCommentBody(body);

  return db.transaction((tx) => {
    if (!lessonExists(tx, lessonId)) {
      throw new Error("Lesson not found");
    }

    if (parentId !== null) {
      const parent = tx
        .select()
        .from(comments)
        .where(eq(comments.id, parentId))
        .get();
      if (!parent) {
        throw new Error("Parent comment not found");
      }
      if (parent.lessonId !== lessonId) {
        throw new Error("Parent comment belongs to a different lesson");
      }
      if (parent.parentId !== null) {
        throw new Error("Replies can only be one level deep");
      }
    }

    return tx
      .insert(comments)
      .values({ userId, lessonId, parentId, body: trimmed })
      .returning()
      .get();
  });
}
