// PROTOTYPE — throwaway. Answers "Prototype: the Notification bell and inbox UI"
// (https://github.com/osmalek/cohort-005-project/issues/5).
// Builds fake Notifications from REAL course/lesson/user names so the variants
// are judged against real density. Nothing is persisted; read state lives in
// the browser and resets on reload.
import { eq, ne } from "drizzle-orm";
import { db } from "~/db";
import { courses, lessons, modules, users, UserRole } from "~/db/schema";

export type ProtoNotificationKind =
  | "comment_reply"
  | "instructor_comment"
  | "lesson_published"
  | "refund_decided";

export interface ProtoNotification {
  id: number;
  kind: ProtoNotificationKind;
  /** Display name of whoever caused it (comments only). */
  actorName: string | null;
  /** Full v1 wording from "Grilling: which events notify whom in v1". */
  text: string;
  /** Short context line: the course the Notification belongs to. */
  courseTitle: string;
  /** Click target. */
  href: string;
  /** Minutes ago, so the prototype needs no clock. */
  minutesAgo: number;
  read: boolean;
  /** Refund only. */
  refundOutcome?: "approved" | "declined";
}

export function getPrototypeNotifications(
  currentUserId: number | null
): ProtoNotification[] {
  if (!currentUserId) return [];
  const me = db.select().from(users).where(eq(users.id, currentUserId)).get();
  if (!me) return [];

  const rows = db
    .select({
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .limit(8)
    .all();
  const others = db
    .select({ name: users.name })
    .from(users)
    .where(ne(users.id, currentUserId))
    .limit(5)
    .all()
    .map((u) => u.name);

  if (rows.length === 0) return [];
  const L = (i: number) => rows[i % rows.length];
  const who = (i: number) => others[i % Math.max(others.length, 1)] ?? "Someone";
  const lessonHref = (i: number, commentId?: number) =>
    `/courses/${L(i).courseSlug}/lessons/${L(i).lessonId}` +
    (commentId ? `#comment-${commentId}` : "");

  let id = 1;
  const reply = (i: number, minutesAgo: number, read: boolean): ProtoNotification => ({
    id: id++,
    kind: "comment_reply",
    actorName: who(i),
    text: `${who(i)} replied to your comment on ${L(i).lessonTitle}`,
    courseTitle: L(i).courseTitle,
    href: lessonHref(i, 100 + i),
    minutesAgo,
    read,
  });

  if (me.role === UserRole.Instructor) {
    const comment = (i: number, minutesAgo: number, read: boolean): ProtoNotification => ({
      id: id++,
      kind: "instructor_comment",
      actorName: who(i),
      text: `${who(i)} commented on ${L(i).lessonTitle}`,
      courseTitle: L(i).courseTitle,
      href: lessonHref(i, 200 + i),
      minutesAgo,
      read,
    });
    return [
      comment(0, 4, false),
      comment(1, 38, false),
      reply(2, 95, false),
      comment(3, 60 * 5, false),
      comment(4, 60 * 26, true),
      comment(5, 60 * 24 * 3, true),
      reply(6, 60 * 24 * 9, true),
    ];
  }

  if (me.role === UserRole.Student) {
    const published = (i: number, minutesAgo: number, read: boolean): ProtoNotification => ({
      id: id++,
      kind: "lesson_published",
      actorName: null,
      text: `New lesson in ${L(i).courseTitle}: ${L(i).lessonTitle}`,
      courseTitle: L(i).courseTitle,
      href: lessonHref(i),
      minutesAgo,
      read,
    });
    const refund = (
      i: number,
      outcome: "approved" | "declined",
      minutesAgo: number,
      read: boolean
    ): ProtoNotification => ({
      id: id++,
      kind: "refund_decided",
      actorName: null,
      text: `Your refund request for ${L(i).courseTitle} was ${outcome}`,
      courseTitle: L(i).courseTitle,
      href: `/courses/${L(i).courseSlug}`,
      minutesAgo,
      read,
      refundOutcome: outcome,
    });
    return [
      reply(0, 12, false),
      published(1, 50, false),
      refund(2, "approved", 60 * 3, false),
      published(3, 60 * 20, true),
      reply(4, 60 * 30, true),
      refund(5, "declined", 60 * 24 * 6, true),
      published(6, 60 * 24 * 12, true),
    ];
  }

  // Platform Admin is out of scope as a recipient: empty inbox.
  return [];
}
