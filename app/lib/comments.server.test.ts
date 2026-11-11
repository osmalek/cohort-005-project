import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { createComment } from "./comments.server";

type TestDb = ReturnType<typeof createTestDb>;

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
    .values({ moduleId: module.id, title: "Lesson 1", position: 1 })
    .returning()
    .get().id;
});

describe("createComment", () => {
  it("writes a top-level comment on a lesson, trimmed", () => {
    const comment = createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "  How do I start?  "
    );

    expect(comment).toMatchObject({
      userId: base.user.id,
      lessonId,
      parentId: null,
      body: "How do I start?",
    });
  });

  it("writes a reply to a top-level comment", () => {
    const question = createComment(db, base.user.id, lessonId, null, "Why?");

    const reply = createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Because."
    );

    expect(reply).toMatchObject({
      userId: base.instructor.id,
      lessonId,
      parentId: question.id,
      body: "Because.",
    });
  });

  it("rejects a reply to a reply", () => {
    const question = createComment(db, base.user.id, lessonId, null, "Why?");
    const reply = createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Because."
    );

    expect(() =>
      createComment(db, base.user.id, lessonId, reply.id, "Why though?")
    ).toThrow("Replies can only be one level deep");
  });

  it("rejects an empty body", () => {
    expect(() =>
      createComment(db, base.user.id, lessonId, null, "   ")
    ).toThrow("Comment cannot be empty");
  });

  it("accepts a body of exactly 5000 characters and rejects 5001", () => {
    const longest = createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "a".repeat(5000)
    );
    expect(longest.body).toHaveLength(5000);

    expect(() =>
      createComment(db, base.user.id, lessonId, null, "a".repeat(5001))
    ).toThrow("Comment must be 5000 characters or fewer");
  });
});
