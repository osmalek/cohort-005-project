import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { createLesson } from "./lessons.server";
import {
  countUnreadNotifications,
  listUnreadNotifications,
  markNotificationRead,
} from "./notifications.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let moduleId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  moduleId = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get().id;
});

function enroll(userId: number) {
  db.insert(schema.enrollments)
    .values({ userId, courseId: base.course.id })
    .run();
}

describe("new_lesson Notifications", () => {
  it("notifies each enrolled Student when a lesson is created in a Published course", () => {
    enroll(base.user.id);

    const lesson = createLesson(
      db,
      base.instructor.id,
      moduleId,
      "Closures",
      NOW
    );

    expect(listUnreadNotifications(db, base.user.id)).toEqual([
      {
        id: expect.any(Number),
        kind: "new_lesson",
        text: "New lesson in Test Course: Closures.",
        href: `/courses/test-course/lessons/${lesson.id}`,
        createdAt: NOW.toISOString(),
        readAt: null,
        hiddenAt: null,
      },
    ]);
    expect(countUnreadNotifications(db, base.instructor.id)).toBe(0);
  });

  it("notifies every enrolled Student once", () => {
    const other = addStudent("Second Student");
    enroll(base.user.id);
    enroll(other);

    createLesson(db, base.instructor.id, moduleId, "Closures", NOW);

    expect(countUnreadNotifications(db, base.user.id)).toBe(1);
    expect(countUnreadNotifications(db, other)).toBe(1);
  });

  it.each([schema.CourseStatus.Draft, schema.CourseStatus.Archived])(
    "notifies nobody when the course is %s",
    (status) => {
      enroll(base.user.id);
      setCourseStatus(status);

      createLesson(db, base.instructor.id, moduleId, "Closures", NOW);

      expect(countUnreadNotifications(db, base.user.id)).toBe(0);
    }
  );

  it("notifies nobody about existing lessons when the course becomes Published", () => {
    enroll(base.user.id);
    setCourseStatus(schema.CourseStatus.Draft);
    createLesson(db, base.instructor.id, moduleId, "Closures", NOW);

    setCourseStatus(schema.CourseStatus.Published);

    expect(countUnreadNotifications(db, base.user.id)).toBe(0);
  });

  it("notifies nobody when an existing lesson is edited", () => {
    enroll(base.user.id);
    const lesson = createLesson(
      db,
      base.instructor.id,
      moduleId,
      "Closures",
      NOW
    );

    db.update(schema.lessons)
      .set({ title: "Closures, revisited" })
      .where(eq(schema.lessons.id, lesson.id))
      .run();

    expect(countUnreadNotifications(db, base.user.id)).toBe(1);
  });

  it("does not notify Lapsed Students or the acting Instructor", () => {
    const lapsed = addStudent("Lapsed Student");
    enroll(lapsed);
    db.delete(schema.enrollments)
      .where(eq(schema.enrollments.userId, lapsed))
      .run();
    enroll(base.instructor.id);

    createLesson(db, base.instructor.id, moduleId, "Closures", NOW);

    expect(countUnreadNotifications(db, lapsed)).toBe(0);
    expect(countUnreadNotifications(db, base.instructor.id)).toBe(0);
  });

  it("is marked read and opens the lesson when clicked", () => {
    enroll(base.user.id);
    const lesson = createLesson(
      db,
      base.instructor.id,
      moduleId,
      "Closures",
      NOW
    );
    const [notification] = listUnreadNotifications(db, base.user.id);

    const href = markNotificationRead(db, base.user.id, notification.id, NOW);

    expect(href).toBe(`/courses/test-course/lessons/${lesson.id}`);
    expect(countUnreadNotifications(db, base.user.id)).toBe(0);
  });

  it("adds the lesson at the end of its module", () => {
    const first = createLesson(db, base.instructor.id, moduleId, "One", NOW);
    const second = createLesson(db, base.instructor.id, moduleId, "Two", NOW);

    expect([first.position, second.position]).toEqual([1, 2]);
  });
});

function addStudent(name: string): number {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase().replace(/ /g, ".")}@example.com`,
      role: schema.UserRole.Student,
    })
    .returning()
    .get().id;
}

function setCourseStatus(status: schema.CourseStatus) {
  db.update(schema.courses)
    .set({ status })
    .where(eq(schema.courses.id, base.course.id))
    .run();
}
