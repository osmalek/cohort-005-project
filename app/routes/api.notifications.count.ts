import type { Route } from "./+types/api.notifications.count";
import { db } from "~/db";
import { requireUserId } from "~/lib/access.server";
import { countUnreadNotifications } from "~/lib/notifications.server";

// GET → { unreadCount } for the signed-in user. Polled by the bell every 60s
// while the tab is visible (see app/hooks/use-unread-notification-count.tsx);
// it never loads the Notification list.

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  return { unreadCount: countUnreadNotifications(db, userId) };
}
