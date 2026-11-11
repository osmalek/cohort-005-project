import { describe, expect, it } from "vitest";
import { isOnBell } from "./notification-groups";

const READ = "2026-10-06T12:00:00.000Z";
const CLEARED = "2026-10-06T12:05:00.000Z";

describe("isOnBell", () => {
  it("is true only for a Notification that is unread and not cleared", () => {
    expect(isOnBell({ readAt: null, hiddenAt: null })).toBe(true);
  });

  it("is false once read, or once cleared even if still unread", () => {
    expect(isOnBell({ readAt: READ, hiddenAt: null })).toBe(false);
    expect(isOnBell({ readAt: null, hiddenAt: CLEARED })).toBe(false);
    expect(isOnBell({ readAt: READ, hiddenAt: CLEARED })).toBe(false);
  });
});
