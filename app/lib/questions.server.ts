import {
  and,
  desc,
  eq,
  isNull,
  not,
  notExists,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias, type SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Queryable } from "~/db/types";
import {
  comments,
  courses,
  lessons,
  modules,
  users,
  UserRole,
} from "~/db/schema";

// ─── Questions ───
// What counts as an unanswered question for the Questions inbox.

export type QueuedQuestion = {
  id: number;
  body: string;
  createdAt: string;
  lessonId: number;
  lessonTitle: string;
  courseTitle: string;
  courseSlug: string;
  authorId: number;
  authorName: string;
  authorAvatarUrl: string | null;
};

/**
 * Whether a comment's author is staff on its course: a Platform Admin, or the
 * course's own Instructor. Staff comments are never questions, and a live
 * staff reply answers one. The one definition shared by the Questions inbox
 * and the `instructor_question` Notification, so the two cannot drift.
 */
export function isCourseStaff(
  authorRole: SQLiteColumn,
  authorId: SQLiteColumn,
  courseInstructorId: SQLiteColumn
): SQL<boolean> {
  return sql<boolean>`(${authorRole} = ${UserRole.Admin} or ${authorId} = ${courseInstructorId})`;
}

/**
 * The Questions inbox: top-level, live comments by anyone other than staff
 * that no staff member (a Platform Admin, or the course's Instructor) has
 * given a live reply. `instructorId` limits it to that Instructor's courses;
 * null (a Platform Admin) spans every course. Newest first.
 */
export function getUnansweredQuestions(
  db: Queryable,
  instructorId: number | null
): QueuedQuestion[] {
  const author = alias(users, "author");
  const reply = alias(comments, "reply");
  const replyAuthor = alias(users, "reply_author");

  // Correlated: matches a live reply, by staff, to the outer question.
  const staffReply = db
    .select({ one: sql`1` })
    .from(reply)
    .innerJoin(replyAuthor, eq(replyAuthor.id, reply.userId))
    .where(
      and(
        eq(reply.parentId, comments.id),
        isNull(reply.deletedAt),
        isCourseStaff(replyAuthor.role, reply.userId, courses.instructorId)
      )
    );

  const conditions = [
    isNull(comments.parentId),
    isNull(comments.deletedAt),
    // Staff asking their own question shouldn't queue up as work for themselves.
    not(isCourseStaff(author.role, comments.userId, courses.instructorId)),
    notExists(staffReply),
  ];

  if (instructorId !== null) {
    conditions.push(eq(courses.instructorId, instructorId));
  }

  return db
    .select({
      id: comments.id,
      body: comments.body,
      createdAt: comments.createdAt,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      authorId: author.id,
      authorName: author.name,
      authorAvatarUrl: author.avatarUrl,
    })
    .from(comments)
    .innerJoin(author, eq(comments.userId, author.id))
    .innerJoin(lessons, eq(comments.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(and(...conditions))
    .orderBy(desc(comments.createdAt), desc(comments.id))
    .all();
}
