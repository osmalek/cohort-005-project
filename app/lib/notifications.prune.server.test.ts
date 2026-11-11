import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { NotificationKind } from "~/db/schema";
import {
  createNotification,
  listUnreadNotifications,
  markNotificationRead,
  pruneReadNotifications,
} from "./notifications.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

function daysBefore(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

/** A Notification for the student, created `createdDaysAgo` days before NOW. */
function notify(createdDaysAgo: number): number {
  const row = createNotification(
    db,
    {
      recipientId: base.user.id,
      kind: NotificationKind.NewLesson,
      actorId: base.instructor.id,
      courseId: base.course.id,
    },
    daysBefore(createdDaysAgo)
  );
  if (!row) throw new Error("Expected a Notification to be written");
  return row.id;
}

function readOn(id: number, daysAgo: number) {
  markNotificationRead(db, base.user.id, id, daysBefore(daysAgo));
}

/** Whether the Notification still exists (opening it finds a link). */
function stillExists(id: number): boolean {
  return markNotificationRead(db, base.user.id, id, NOW) !== null;
}

describe("pruneReadNotifications", () => {
  it("deletes read Notifications more than 90 days past their read time", () => {
    const id = notify(200);
    readOn(id, 91);

    pruneReadNotifications(db, NOW);

    expect(stillExists(id)).toBe(false);
  });

  it("keeps read Notifications read within the last 90 days", () => {
    const recent = notify(200);
    readOn(recent, 10);
    const onTheBoundary = notify(200);
    readOn(onTheBoundary, 90);

    pruneReadNotifications(db, NOW);

    expect(stillExists(recent)).toBe(true);
    expect(stillExists(onTheBoundary)).toBe(true);
  });

  it("never deletes unread Notifications, however old", () => {
    const id = notify(1000);

    pruneReadNotifications(db, NOW);

    expect(listUnreadNotifications(db, base.user.id).map((n) => n.id)).toEqual(
      [id]
    );
  });

  it("never deletes cleared-but-unread Notifications, however old", () => {
    const id = notify(1000);
    db.update(schema.notifications)
      .set({ hiddenAt: daysBefore(999).toISOString() })
      .where(eq(schema.notifications.id, id))
      .run();

    pruneReadNotifications(db, NOW);

    expect(stillExists(id)).toBe(true);
  });

  it("dates the 90 days from reading, not from clearing", () => {
    const id = notify(200);
    readOn(id, 100);
    db.update(schema.notifications)
      .set({ hiddenAt: daysBefore(5).toISOString() })
      .where(eq(schema.notifications.id, id))
      .run();

    pruneReadNotifications(db, NOW);

    expect(stillExists(id)).toBe(false);
  });
});
