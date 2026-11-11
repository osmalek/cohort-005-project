import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { createComment, deleteComment } from "./comments.server";
import {
  countUnreadNotifications,
  listEarlierNotifications,
  listUnreadNotifications,
  markNotificationRead,
} from "./notifications.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

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

describe("comment_reply Notifications", () => {
  it("notifies the parent comment's author when someone else replies", () => {
    const question = createComment(db, base.user.id, lessonId, null, "Why?");
    const reply = createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Because.",
      NOW
    );

    expect(listUnreadNotifications(db, base.user.id)).toEqual([
      {
        id: expect.any(Number),
        kind: "comment_reply",
        text: "Test Instructor replied to your comment on Getting Started.",
        href: `/courses/test-course/lessons/${lessonId}#comment-${reply.id}`,
        createdAt: NOW.toISOString(),
        readAt: null,
        hiddenAt: null,
      },
    ]);
    expect(listUnreadNotifications(db, base.instructor.id)).toEqual([]);
  });

  it("does not notify you when you reply to your own comment", () => {
    const question = createComment(db, base.user.id, lessonId, null, "Why?");
    createComment(db, base.user.id, lessonId, question.id, "Found it.", NOW);

    expect(listUnreadNotifications(db, base.user.id)).toEqual([]);
    expect(countUnreadNotifications(db, base.user.id)).toBe(0);
  });

  it("deleting the reply takes its Notification off the bell and out of See earlier", () => {
    const question = createComment(db, base.user.id, lessonId, null, "Why?");
    const reply = createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Because.",
      NOW
    );
    expect(countUnreadNotifications(db, base.user.id)).toBe(1);

    deleteComment(db, reply.id, base.instructor.id, true, NOW);

    expect(listUnreadNotifications(db, base.user.id)).toEqual([]);
    expect(countUnreadNotifications(db, base.user.id)).toBe(0);
    expect(listEarlierNotifications(db, base.user.id)).toEqual([]);
  });

  it("creates nothing when the reply is rejected", () => {
    const question = createComment(db, base.user.id, lessonId, null, "Why?");

    expect(() =>
      createComment(db, base.instructor.id, lessonId, question.id, "   ", NOW)
    ).toThrow();
    expect(countUnreadNotifications(db, base.user.id)).toBe(0);
  });
});

describe("the bell", () => {
  function replyTo(parentAuthorId: number, replierId: number, at: Date) {
    const question = createComment(db, parentAuthorId, lessonId, null, "Q");
    return createComment(db, replierId, lessonId, question.id, "A", at);
  }

  it("counts unread Notifications and lists them newest first", () => {
    const older = replyTo(base.user.id, base.instructor.id, NOW);
    const newer = replyTo(
      base.user.id,
      base.instructor.id,
      new Date(NOW.getTime() + 60_000)
    );

    expect(countUnreadNotifications(db, base.user.id)).toBe(2);
    expect(
      listUnreadNotifications(db, base.user.id).map((n) => n.href)
    ).toEqual([
      `/courses/test-course/lessons/${lessonId}#comment-${newer.id}`,
      `/courses/test-course/lessons/${lessonId}#comment-${older.id}`,
    ]);
  });

  it("marking a Notification read drops it from the count and the list, and returns its link", () => {
    const reply = replyTo(base.user.id, base.instructor.id, NOW);
    const [notification] = listUnreadNotifications(db, base.user.id);

    const href = markNotificationRead(db, base.user.id, notification.id, NOW);

    expect(href).toBe(
      `/courses/test-course/lessons/${lessonId}#comment-${reply.id}`
    );
    expect(countUnreadNotifications(db, base.user.id)).toBe(0);
    expect(listUnreadNotifications(db, base.user.id)).toEqual([]);
  });

  it("a user cannot mark someone else's Notification read", () => {
    replyTo(base.user.id, base.instructor.id, NOW);
    const [notification] = listUnreadNotifications(db, base.user.id);

    expect(
      markNotificationRead(db, base.instructor.id, notification.id, NOW)
    ).toBeNull();
    expect(countUnreadNotifications(db, base.user.id)).toBe(1);
  });
});
