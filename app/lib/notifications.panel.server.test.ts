import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { NotificationKind } from "~/db/schema";
import { createComment, deleteComment } from "./comments.server";
import {
  clearNotifications,
  countUnreadNotifications,
  createNotification,
  listEarlierNotifications,
  listUnreadNotifications,
  markNotificationRead,
} from "./notifications.server";
import { isOnBell } from "./notification-groups";

// The bell's panel: "See earlier" and Clear (ticket #15).

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);
const minutesLater = (m: number) => new Date(NOW.getTime() + m * 60_000);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Getting Started", position: 1 })
    .returning()
    .get().id;
});

/** The id of a Notification the test expects to have been written. */
function written(row: { id: number } | null): number {
  if (!row) throw new Error("Expected a Notification to be written");
  return row.id;
}

/** One Notification of `kind` for the Student, created at `at`. */
function notify(kind: NotificationKind, at: Date): number {
  return written(
    createNotification(
      db,
      {
        recipientId: base.user.id,
        kind,
        actorId: base.instructor.id,
        courseId: base.course.id,
        lessonId,
      },
      at
    )
  );
}

const ids = (views: { id: number }[]) => views.map((n) => n.id);

describe("See earlier", () => {
  it("lists every read Notification, newest first, and none that are unread", () => {
    const first = notify(NotificationKind.CommentReply, minutesLater(0));
    const second = notify(NotificationKind.NewLesson, minutesLater(1));
    const unread = notify(NotificationKind.CommentReply, minutesLater(2));
    const third = notify(NotificationKind.RefundDecided, minutesLater(3));

    for (const id of [first, second, third]) {
      markNotificationRead(db, base.user.id, id, minutesLater(10));
    }

    expect(ids(listEarlierNotifications(db, base.user.id))).toEqual([
      third,
      second,
      first,
    ]);
    expect(ids(listUnreadNotifications(db, base.user.id))).toEqual([unread]);
  });

  it("has no count cap", () => {
    for (let i = 0; i < 60; i++) {
      const id = notify(NotificationKind.CommentReply, minutesLater(i));
      markNotificationRead(db, base.user.id, id, minutesLater(100));
    }

    expect(listEarlierNotifications(db, base.user.id)).toHaveLength(60);
  });

  it("leaves out a Notification whose comment was deleted", () => {
    const question = createComment(db, base.user.id, lessonId, null, "Why?", NOW);
    const [notification] = listUnreadNotifications(db, base.instructor.id);
    markNotificationRead(db, base.instructor.id, notification.id, NOW);
    expect(ids(listEarlierNotifications(db, base.instructor.id))).toEqual([
      notification.id,
    ]);

    deleteComment(db, question.id, base.user.id, false, minutesLater(1));

    expect(listEarlierNotifications(db, base.instructor.id)).toEqual([]);
  });

  it("shows only your own Notifications", () => {
    const id = notify(NotificationKind.CommentReply, NOW);
    markNotificationRead(db, base.user.id, id, NOW);

    expect(listEarlierNotifications(db, base.instructor.id)).toEqual([]);
  });
});

describe("Clear", () => {
  it("on a group hides that group's Notifications from the bell and lowers the count", () => {
    const reply = notify(NotificationKind.CommentReply, minutesLater(0));
    const question = notify(NotificationKind.InstructorQuestion, minutesLater(1));
    const lesson = notify(NotificationKind.NewLesson, minutesLater(2));
    const refund = notify(NotificationKind.RefundDecided, minutesLater(3));

    clearNotifications(db, base.user.id, "comments", minutesLater(5));

    expect(countUnreadNotifications(db, base.user.id)).toBe(2);
    expect(ids(listUnreadNotifications(db, base.user.id))).toEqual([
      refund,
      lesson,
    ]);
    expect(ids(listEarlierNotifications(db, base.user.id))).toEqual([
      question,
      reply,
    ]);

    clearNotifications(db, base.user.id, "lessons", minutesLater(6));
    expect(ids(listUnreadNotifications(db, base.user.id))).toEqual([refund]);

    clearNotifications(db, base.user.id, "refunds", minutesLater(7));
    expect(countUnreadNotifications(db, base.user.id)).toBe(0);
  });

  it("for everything empties the bell", () => {
    notify(NotificationKind.CommentReply, minutesLater(0));
    notify(NotificationKind.NewLesson, minutesLater(1));
    notify(NotificationKind.RefundDecided, minutesLater(2));

    clearNotifications(db, base.user.id, "all", minutesLater(5));

    expect(countUnreadNotifications(db, base.user.id)).toBe(0);
    expect(listUnreadNotifications(db, base.user.id)).toEqual([]);
  });

  it("does not delete: cleared Notifications still appear under See earlier", () => {
    const read = notify(NotificationKind.CommentReply, minutesLater(0));
    markNotificationRead(db, base.user.id, read, minutesLater(1));
    const unread = notify(NotificationKind.NewLesson, minutesLater(2));

    clearNotifications(db, base.user.id, "all", minutesLater(5));

    expect(ids(listEarlierNotifications(db, base.user.id))).toEqual([
      unread,
      read,
    ]);
  });

  it("marks a cleared Notification in See earlier as cleared, so opening it does not lower the count again", () => {
    const cleared = notify(NotificationKind.CommentReply, NOW);
    clearNotifications(db, base.user.id, "all", minutesLater(5));

    expect(listEarlierNotifications(db, base.user.id)).toMatchObject([
      { id: cleared, readAt: null, hiddenAt: minutesLater(5).toISOString() },
    ]);
    expect(
      listEarlierNotifications(db, base.user.id).filter(isOnBell)
    ).toHaveLength(countUnreadNotifications(db, base.user.id));
  });

  it("leaves a cleared Notification openable, and other users' bells alone", () => {
    const mine = notify(NotificationKind.CommentReply, NOW);
    const theirs = written(
      createNotification(
        db,
        {
          recipientId: base.instructor.id,
          kind: NotificationKind.CommentReply,
          actorId: base.user.id,
          courseId: base.course.id,
          lessonId,
        },
        NOW
      )
    );

    clearNotifications(db, base.user.id, "all", minutesLater(5));

    expect(ids(listUnreadNotifications(db, base.instructor.id))).toEqual([
      theirs,
    ]);
    expect(
      markNotificationRead(db, base.user.id, mine, minutesLater(6))
    ).not.toBeNull();
  });
});
