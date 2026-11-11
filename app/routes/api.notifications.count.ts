import { data } from "react-router";
import type { Route } from "./+types/api.notifications.count";
import { db } from "~/db";
import { getCurrentUserId } from "~/lib/session";
import { countUnreadNotifications } from "~/lib/notifications.server";

// GET → { unreadCount } for the signed-in user. Polled by the bell every 60s
// while the tab is visible (see app/hooks/use-unread-notification-count.tsx);
// it never loads the Notification list.

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    throw data("Select a user from the DevUI panel", { status: 401 });
  }
  return { unreadCount: countUnreadNotifications(db, userId) };
}
