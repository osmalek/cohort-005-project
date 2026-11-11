import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { createComment, deleteComment } from "./comments.server";
import {
  countUnreadNotifications,
  listUnreadNotifications,
  markNotificationRead,
} from "./notifications.server";
import { getUnansweredQuestions } from "./questions.server";

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

describe("instructor_question Notifications", () => {
  it("notifies the course's Instructor when a Student asks a top-level question", () => {
    const question = createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?",
      NOW
    );

    expect(listUnreadNotifications(db, base.instructor.id)).toEqual([
      {
        id: expect.any(Number),
        kind: "instructor_question",
        text: "Test User asked a question on Getting Started.",
        href: `/instructor/questions#question-${question.id}`,
        createdAt: NOW.toISOString(),
        readAt: null,
      },
    ]);
    expect(listUnreadNotifications(db, base.user.id)).toEqual([]);
  });

  it("does not notify the Instructor of replies inside a thread", () => {
    const other = addUser("Other Student", schema.UserRole.Student);
    const question = createComment(db, base.user.id, lessonId, null, "Why?");
    createComment(db, other.id, lessonId, question.id, "Me too", NOW);
    createComment(db, base.user.id, lessonId, question.id, "Anyone?", NOW);

    expect(questionNotifications(base.instructor.id)).toHaveLength(1);
  });

  it("does not notify the Instructor of their own top-level comments", () => {
    createComment(db, base.instructor.id, lessonId, null, "Welcome!", NOW);

    expect(questionNotifications(base.instructor.id)).toEqual([]);
  });

  it("does not notify the Instructor of an Admin's top-level comments", () => {
    const admin = addUser("Platform Admin", schema.UserRole.Admin);
    createComment(db, admin.id, lessonId, null, "Heads up", NOW);

    expect(questionNotifications(base.instructor.id)).toEqual([]);
  });

  it("does not notify an Instructor of questions on courses they do not own", () => {
    const otherInstructor = addUser(
      "Other Instructor",
      schema.UserRole.Instructor
    );
    createComment(db, base.user.id, lessonId, null, "Why?", NOW);

    expect(questionNotifications(otherInstructor.id)).toEqual([]);
  });
});

describe("instructor_question Notifications follow the Questions inbox", () => {
  it("clicking the Notification marks it read, opens the question, and leaves it unanswered", () => {
    const question = createComment(db, base.user.id, lessonId, null, "Why?");
    const [notification] = questionNotifications(base.instructor.id);

    const href = markNotificationRead(
      db,
      base.instructor.id,
      notification.id,
      NOW
    );

    expect(href).toBe(`/instructor/questions#question-${question.id}`);
    expect(questionNotifications(base.instructor.id)).toEqual([]);
    expect(
      getUnansweredQuestions(db, base.instructor.id).map((q) => q.id)
    ).toEqual([question.id]);
  });

  it("a reply by the Instructor marks the question's Notification read", () => {
    const question = createComment(db, base.user.id, lessonId, null, "Why?");
    const other = createComment(db, base.user.id, lessonId, null, "And?");

    createComment(db, base.instructor.id, lessonId, question.id, "Because.");

    expect(
      questionNotifications(base.instructor.id).map((n) => n.href)
    ).toEqual([`/instructor/questions#question-${other.id}`]);
  });

  it("a reply by an Admin marks the question's Notification read", () => {
    const admin = addUser("Platform Admin", schema.UserRole.Admin);
    const question = createComment(db, base.user.id, lessonId, null, "Why?");

    createComment(db, admin.id, lessonId, question.id, "Because.");

    expect(questionNotifications(base.instructor.id)).toEqual([]);
  });

  it("a reply by another Student leaves the Notification unread", () => {
    const other = addUser("Other Student", schema.UserRole.Student);
    const question = createComment(db, base.user.id, lessonId, null, "Why?");

    createComment(db, other.id, lessonId, question.id, "No idea.");

    expect(questionNotifications(base.instructor.id)).toHaveLength(1);
  });

  it("deleting the question hides its Notification from the bell", () => {
    const question = createComment(db, base.user.id, lessonId, null, "Why?");

    deleteComment(db, question.id, base.user.id, false, NOW);

    expect(questionNotifications(base.instructor.id)).toEqual([]);
    expect(countUnreadNotifications(db, base.instructor.id)).toBe(0);
  });

  it("deleting a reply leaves the question's Notification on the bell", () => {
    const other = addUser("Other Student", schema.UserRole.Student);
    const question = createComment(db, base.user.id, lessonId, null, "Why?");
    const reply = createComment(db, other.id, lessonId, question.id, "Hm.");

    deleteComment(db, reply.id, other.id, false, NOW);

    expect(questionNotifications(base.instructor.id)).toHaveLength(1);
  });
});

function addUser(name: string, role: schema.UserRole) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase().replace(/ /g, ".")}@example.com`,
      role,
    })
    .returning()
    .get();
}

function questionNotifications(userId: number) {
  return listUnreadNotifications(db, userId).filter(
    (n) => n.kind === "instructor_question"
  );
}
