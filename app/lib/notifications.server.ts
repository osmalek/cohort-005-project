import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Queryable } from "~/db/types";
import * as schema from "~/db/schema";
import {
  NotificationKind,
  RefundStatus,
  comments,
  courses,
  lessons,
  notifications,
  refunds,
  users,
} from "~/db/schema";
import { kindsInGroup, type ClearTarget } from "~/lib/notification-groups";
import { isCourseStaff } from "~/lib/questions.server";

// ─── Notifications ───
// Owns every Notification: creating them from the write paths that report an
// event, and listing, counting and marking them read for the bell.
//
// Every function takes the database first (or the caller's transaction, so a
// Notification is written in the same transaction as the event it reports)
// and, when it writes a timestamp, `now` last.
//
// Adding a kind touches several places:
// 1. `NotificationKind` in app/db/schema.ts (with the database-migrations
//    skill if it needs a new target column).
// 2. A `notify…` function here that calls `createNotification` with the
//    target columns the kind needs, called from the write path that reports
//    the event, inside its transaction.
// 3. A case in `present()` for its wording and link (and a join in
//    `selectForPresentation` if the wording needs new data).
// 4. Its group in app/lib/notification-groups.ts, so the panel shows it, and
//    its icon in `KindIcon` (app/components/notification-panel.tsx).
// The type checker flags 3 and the icon (exhaustive switches); 2 and the
// group are on you.

export type Notification = typeof notifications.$inferSelect;

/** A Notification as the bell shows it. */
export type NotificationView = {
  id: number;
  kind: NotificationKind;
  text: string;
  href: string;
  createdAt: string;
  readAt: string | null;
  /** Set once cleared from the bell (see `clearNotifications`). */
  hiddenAt: string | null;
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
 * (`instructor_question`). It follows the Questions inbox (`isCourseStaff`):
 * comments by a Platform Admin or by the Instructor themselves are not
 * questions, and replies never notify the Instructor. A live staff reply answers the question, so it marks
 * the question's Notification read.
 */
function notifyInstructorOfQuestion(
  tx: Queryable,
  comment: typeof comments.$inferSelect,
  now: Date
): void {
  const course = tx
    .select({
      id: courses.id,
      instructorId: courses.instructorId,
      authorIsStaff: isCourseStaff(
        users.role,
        users.id,
        courses.instructorId
      ).mapWith(Boolean),
    })
    .from(lessons)
    .innerJoin(schema.modules, eq(lessons.moduleId, schema.modules.id))
    .innerJoin(courses, eq(schema.modules.courseId, courses.id))
    .innerJoin(users, eq(users.id, comment.userId))
    .where(eq(lessons.id, comment.lessonId))
    .get();
  if (!course) return;
  const isStaff = course.authorIsStaff;

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
 * comment's Notification leaves the bell, as it already leaves "See earlier":
 * a deleted question's `instructor_question` (it leaves the Questions inbox
 * too) and a deleted reply's `comment_reply`.
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
        inArray(notifications.kind, [
          NotificationKind.InstructorQuestion,
          NotificationKind.CommentReply,
        ]),
        eq(notifications.commentId, comment.id),
        isNull(notifications.hiddenAt)
      )
    )
    .run();
}

/**
 * Called by the Refund Request decision paths, inside their transaction, once
 * a Platform Admin approves or declines. Tells the buyer on the Purchase
 * (`refund_decided`); the decision and its note are read from the refund row.
 */
export function notifyRefundDecided(
  tx: Queryable,
  refund: {
    id: number;
    buyerId: number;
    courseId: number;
    platformAdminId: number;
  },
  now: Date
): void {
  createNotification(
    tx,
    {
      recipientId: refund.buyerId,
      kind: NotificationKind.RefundDecided,
      actorId: refund.platformAdminId,
      courseId: refund.courseId,
      refundId: refund.id,
    },
    now
  );
}

/**
 * Called by the lesson write path, inside its transaction, for every new
 * lesson. In a Published course, each Student with a current Enrollment gets
 * a `new_lesson` Notification. Lapsed Students have no Enrollment row, so
 * they are not recipients. Draft and Archived courses notify nobody.
 */
export function notifyLessonCreated(
  tx: Queryable,
  lesson: typeof lessons.$inferSelect,
  actorId: number,
  now: Date
): void {
  const course = tx
    .select({ id: courses.id, status: courses.status })
    .from(schema.modules)
    .innerJoin(courses, eq(schema.modules.courseId, courses.id))
    .where(eq(schema.modules.id, lesson.moduleId))
    .get();
  if (!course || course.status !== schema.CourseStatus.Published) return;

  const enrolled = tx
    .select({ userId: schema.enrollments.userId })
    .from(schema.enrollments)
    .where(eq(schema.enrollments.courseId, course.id))
    .all();

  for (const { userId } of enrolled) {
    createNotification(
      tx,
      {
        recipientId: userId,
        kind: NotificationKind.NewLesson,
        actorId,
        courseId: course.id,
        lessonId: lesson.id,
      },
      now
    );
  }
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
  const notification = row.notification;
  const name = row.actorName ?? "Someone";
  const lesson = row.lessonTitle ?? "a lesson";
  const lessonHref = `/courses/${row.courseSlug}/lessons/${notification.lessonId}`;

  switch (notification.kind) {
    case NotificationKind.CommentReply:
      return {
        text: `${name} replied to your comment on ${lesson}.`,
        href: `${lessonHref}#comment-${notification.commentId}`,
      };
    case NotificationKind.InstructorQuestion:
      return {
        text: `${name} asked a question on ${lesson}.`,
        href: `/instructor/questions#question-${notification.commentId}`,
      };
    case NotificationKind.RefundDecided: {
      const course = row.courseTitle ?? "your course";
      return {
        text:
          row.refundStatus === RefundStatus.Declined
            ? `Your refund request for ${course} was declined: ${asSentence(row.refundNote ?? "")}`
            : `Your refund request for ${course} was approved. Your access has ended.`,
        href: `/courses/${row.courseSlug}#refund-${notification.refundId}`,
      };
    }
    case NotificationKind.NewLesson:
      return {
        text: `New lesson in ${row.courseTitle ?? "a course"}: ${lesson}.`,
        href: lessonHref,
      };
    default:
      // Every kind has a case above; a new kind fails to compile here.
      return notification.kind satisfies never;
  }
}

/** Ends `text` with a full stop unless it already ends with . ! or ? */
function asSentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function toView(row: PresentableRow): NotificationView {
  const notification = row.notification;
  return {
    id: notification.id,
    kind: notification.kind,
    ...present(row),
    createdAt: notification.createdAt,
    readAt: notification.readAt,
    hiddenAt: notification.hiddenAt,
  };
}

/** Unread, uncleared Notifications on the bell: the condition the count uses. */
function unreadAndNotCleared(userId: number) {
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
    .where(unreadAndNotCleared(userId))
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
      .where(unreadAndNotCleared(userId))
      .get()?.n ?? 0
  );
}

/**
 * The panel's "See earlier" section: every Notification that has left the
 * bell, because it was read or cleared, newest first, except those whose
 * comment was deleted. No count cap; prune is what bounds it.
 */
export function listEarlierNotifications(
  db: Queryable,
  userId: number
): NotificationView[] {
  return selectForPresentation(db)
    .leftJoin(comments, eq(notifications.commentId, comments.id))
    .where(
      and(
        eq(notifications.recipientId, userId),
        or(isNotNull(notifications.readAt), isNotNull(notifications.hiddenAt)),
        // A deleted comment's Notification leaves the feed entirely.
        isNull(comments.deletedAt)
      )
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .all()
    .map(toView);
}

// ─── Clearing ───

/**
 * Clear in the panel: hides the user's bell Notifications in one group (or
 * all of them) by setting `hidden_at`. Never deletes, and does not mark them
 * read; cleared Notifications move to "See earlier". Returns how many were
 * cleared.
 */
export function clearNotifications(
  db: Queryable,
  userId: number,
  target: ClearTarget,
  now: Date
): number {
  const inGroup =
    target === "all"
      ? undefined
      : inArray(notifications.kind, kindsInGroup(target));
  return db
    .update(notifications)
    .set({ hiddenAt: now.toISOString() })
    .where(and(unreadAndNotCleared(userId), inGroup))
    .run().changes;
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

// ─── Pruning ───

/** How long a read Notification is kept after it was read. */
export const READ_NOTIFICATION_RETENTION_DAYS = 90;

/**
 * Deletes Notifications read more than 90 days before `now`. Unread ones are
 * kept however old, cleared or not: only reading starts the clock. There is no
 * scheduler, so this runs lazily from the bell's endpoint. Returns how many
 * were deleted.
 */
export function pruneReadNotifications(db: Queryable, now: Date): number {
  const cutoff = new Date(
    now.getTime() - READ_NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000
  );
  return db
    .delete(notifications)
    .where(lt(notifications.readAt, cutoff.toISOString()))
    .run().changes;
}
