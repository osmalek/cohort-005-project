import { and, count, desc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import {
  NotificationKind,
  comments,
  courses,
  lessons,
  notifications,
  refunds,
  users,
} from "~/db/schema";

// ─── Notifications ───
// Owns every Notification: creating them from the write paths that report an
// event, and listing, counting and marking them read for the bell.
//
// Every function takes the database first (or the caller's transaction, so a
// Notification is written in the same transaction as the event it reports)
// and, when it writes a timestamp, `now` last.
//
// Adding a kind: write a `notify…` function that calls `createNotification`
// with the target columns the kind needs, and add a case to `present()` for
// its wording and link. Nothing else needs to change.

export type Db = BetterSQLite3Database<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Queryable = Db | Tx;

export type Notification = typeof notifications.$inferSelect;

/** A Notification as the bell shows it. */
export type NotificationView = {
  id: number;
  kind: NotificationKind;
  text: string;
  href: string;
  createdAt: string;
  readAt: string | null;
};

type NewNotification = {
  recipientId: number;
  kind: NotificationKind;
  actorId: number | null;
  courseId?: number | null;
  lessonId?: number | null;
  commentId?: number | null;
  refundId?: number | null;
};

// ─── Creating ───

/**
 * Writes one unread Notification. Nobody is notified of their own action, so
 * this writes nothing (and returns null) when the recipient is the actor.
 */
export function createNotification(
  db: Queryable,
  values: NewNotification,
  now: Date
): Notification | null {
  if (values.actorId !== null && values.actorId === values.recipientId) {
    return null;
  }
  return db
    .insert(notifications)
    .values({ ...values, createdAt: now.toISOString() })
    .returning()
    .get();
}

/**
 * Called by the comment write path, inside its transaction, for every new
 * comment. A reply notifies the parent comment's author (`comment_reply`).
 */
export function notifyCommentWritten(
  tx: Queryable,
  comment: typeof comments.$inferSelect,
  now: Date
): void {
  if (comment.parentId !== null) {
    const parent = tx
      .select({ userId: comments.userId })
      .from(comments)
      .where(eq(comments.id, comment.parentId))
      .get();
    if (!parent) return;

    createNotification(
      tx,
      {
        recipientId: parent.userId,
        kind: NotificationKind.CommentReply,
        actorId: comment.userId,
        courseId: courseIdForLesson(tx, comment.lessonId),
        lessonId: comment.lessonId,
        commentId: comment.id,
      },
      now
    );
  }

  notifyInstructorOfQuestion(tx, comment, now);
}

/**
 * A top-level comment is a question for the Instructor who owns the course
 * (`instructor_question`). It follows the Questions inbox: comments by an
 * Admin or by the Instructor themselves are not questions, and replies never
 * notify the Instructor. A live staff reply answers the question, so it marks
 * the question's Notification read.
 */
function notifyInstructorOfQuestion(
  tx: Queryable,
  comment: typeof comments.$inferSelect,
  now: Date
): void {
  const course = tx
    .select({ id: courses.id, instructorId: courses.instructorId })
    .from(lessons)
    .innerJoin(schema.modules, eq(lessons.moduleId, schema.modules.id))
    .innerJoin(courses, eq(schema.modules.courseId, courses.id))
    .where(eq(lessons.id, comment.lessonId))
    .get();
  if (!course) return;

  const author = tx
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, comment.userId))
    .get();
  if (!author) return;
  const isStaff =
    author.role === schema.UserRole.Admin ||
    comment.userId === course.instructorId;

  if (comment.parentId !== null) {
    if (isStaff) {
      tx.update(notifications)
        .set({ readAt: now.toISOString() })
        .where(
          and(
            eq(notifications.kind, NotificationKind.InstructorQuestion),
            eq(notifications.commentId, comment.parentId),
            isNull(notifications.readAt)
          )
        )
        .run();
    }
    return;
  }

  if (isStaff) return;

  createNotification(
    tx,
    {
      recipientId: course.instructorId,
      kind: NotificationKind.InstructorQuestion,
      actorId: comment.userId,
      courseId: course.id,
      lessonId: comment.lessonId,
      commentId: comment.id,
    },
    now
  );
}

/**
 * Called by the comment delete path, inside its transaction. A deleted
 * question leaves the Questions inbox, so its `instructor_question`
 * Notification leaves the bell.
 */
export function notifyCommentDeleted(
  tx: Queryable,
  comment: typeof comments.$inferSelect,
  now: Date
): void {
  tx.update(notifications)
    .set({ hiddenAt: now.toISOString() })
    .where(
      and(
        eq(notifications.kind, NotificationKind.InstructorQuestion),
        eq(notifications.commentId, comment.id),
        isNull(notifications.hiddenAt)
      )
    )
    .run();
}

function courseIdForLesson(db: Queryable, lessonId: number): number | null {
  const row = db
    .select({ courseId: schema.modules.courseId })
    .from(lessons)
    .innerJoin(schema.modules, eq(lessons.moduleId, schema.modules.id))
    .where(eq(lessons.id, lessonId))
    .get();
  return row?.courseId ?? null;
}

// ─── Reading ───

const actors = alias(users, "actors");

/** Everything `present()` may need, joined onto each Notification row. */
function selectForPresentation(db: Queryable) {
  return db
    .select({
      notification: notifications,
      actorName: actors.name,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      lessonTitle: lessons.title,
      refundStatus: refunds.status,
      refundNote: refunds.decisionNote,
    })
    .from(notifications)
    .leftJoin(actors, eq(notifications.actorId, actors.id))
    .leftJoin(courses, eq(notifications.courseId, courses.id))
    .leftJoin(lessons, eq(notifications.lessonId, lessons.id))
    .leftJoin(refunds, eq(notifications.refundId, refunds.id));
}

type PresentableRow = Awaited<
  ReturnType<ReturnType<typeof selectForPresentation>["all"]>
>[number];

/** The one place each kind's wording and link are built. */
function present(row: PresentableRow): { text: string; href: string } {
  const n = row.notification;
  const name = row.actorName ?? "Someone";
  const lesson = row.lessonTitle ?? "a lesson";
  const lessonHref = `/courses/${row.courseSlug}/lessons/${n.lessonId}`;

  switch (n.kind) {
    case NotificationKind.CommentReply:
      return {
        text: `${name} replied to your comment on ${lesson}.`,
        href: `${lessonHref}#comment-${n.commentId}`,
      };
    case NotificationKind.InstructorQuestion:
      return {
        text: `${name} asked a question on ${lesson}.`,
        href: `/instructor/questions#question-${n.commentId}`,
      };
    // new_lesson (#14) and refund_decided (#13)
    // add their cases here.
    default:
      return { text: "You have a new Notification.", href: "/dashboard" };
  }
}

function toView(row: PresentableRow): NotificationView {
  const n = row.notification;
  return {
    id: n.id,
    kind: n.kind,
    ...present(row),
    createdAt: n.createdAt,
    readAt: n.readAt,
  };
}

/** Unread, uncleared Notifications on the bell: the condition the count uses. */
function onBell(userId: number) {
  return and(
    eq(notifications.recipientId, userId),
    isNull(notifications.readAt),
    isNull(notifications.hiddenAt)
  );
}

/** A user's unread Notifications, newest first. */
export function listUnreadNotifications(
  db: Queryable,
  userId: number
): NotificationView[] {
  return selectForPresentation(db)
    .where(onBell(userId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .all()
    .map(toView);
}

/** How many unread Notifications the bell shows ("N new"). */
export function countUnreadNotifications(db: Queryable, userId: number): number {
  return (
    db
      .select({ n: count() })
      .from(notifications)
      .where(onBell(userId))
      .get()?.n ?? 0
  );
}

// ─── Reading a Notification ───

/**
 * Marks one of the user's Notifications read (clicking it in the bell) and
 * returns the link to open. Returns null when the Notification does not
 * exist or belongs to someone else. Reading again keeps the first read time.
 */
export function markNotificationRead(
  db: Queryable,
  userId: number,
  notificationId: number,
  now: Date
): string | null {
  const row = selectForPresentation(db)
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.recipientId, userId)
      )
    )
    .get();
  if (!row) return null;

  if (row.notification.readAt === null) {
    db.update(notifications)
      .set({ readAt: now.toISOString() })
      .where(eq(notifications.id, notificationId))
      .run();
  }
  return present(row).href;
}
