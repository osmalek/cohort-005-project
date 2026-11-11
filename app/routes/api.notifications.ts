import { data, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/api.notifications";
import { db } from "~/db";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import {
  clearNotifications,
  countUnreadNotifications,
  listEarlierNotifications,
  listUnreadNotifications,
  markNotificationRead,
  pruneReadNotifications,
} from "~/lib/notifications.server";
import { CLEAR_TARGETS } from "~/lib/notification-groups";

// The bell's data endpoint. Every request is scoped to the signed-in user, so
// nobody can read or change someone else's Notifications.
//
// GET  → { unreadCount, notifications, earlier }: loaded when the bell is
//        opened. `earlier` is the panel's "See earlier" section.
// POST → keyed by `intent`:
//   mark-read  marks one Notification read, then redirects to its target.
//   clear      hides one group (`target`) or everything ("all") from the bell.

async function requireUserId(request: Request): Promise<number> {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    throw data("Select a user from the DevUI panel", { status: 401 });
  }
  return userId;
}

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  pruneReadNotifications(db, new Date()); // no scheduler, so prune lazily
  return {
    unreadCount: countUnreadNotifications(db, userId),
    notifications: listUnreadNotifications(db, userId),
    earlier: listEarlierNotifications(db, userId),
  };
}

const actionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("mark-read"),
    notificationId: z.coerce.number().int(),
  }),
  z.object({
    intent: z.literal("clear"),
    target: z.enum(CLEAR_TARGETS),
  }),
]);

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const parsed = parseFormData(await request.formData(), actionSchema);
  if (!parsed.success) {
    throw data("Invalid parameters", { status: 400 });
  }

  switch (parsed.data.intent) {
    case "mark-read": {
      const href = markNotificationRead(
        db,
        userId,
        parsed.data.notificationId,
        new Date()
      );
      if (!href) throw data("Notification not found", { status: 404 });
      return redirect(href);
    }
    case "clear": {
      const cleared = clearNotifications(
        db,
        userId,
        parsed.data.target,
        new Date()
      );
      return { cleared };
    }
  }
}
