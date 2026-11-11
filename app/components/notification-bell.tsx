import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Bell } from "lucide-react";
import { cn } from "~/lib/utils";
import type { loader as notificationsLoader } from "~/routes/api.notifications";
import {
  NOTIFICATIONS_ENDPOINT,
  NotificationPanel,
} from "~/components/notification-panel";
import {
  UnreadNotificationCountProvider,
  useUnreadNotificationCount,
} from "~/hooks/use-unread-notification-count";

// The Notification bell in the top bar (Variant C of the prototype). The
// count starts from the app layout's loader and is kept live by
// UnreadNotificationCountProvider (polls while the tab is visible; local
// mark-read/Clear update it at once). The list loads from /api/notifications
// only when the bell is opened, and is drawn by NotificationPanel.

export { NOTIFICATIONS_ENDPOINT };

/** Closes a popover on an outside click or Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

export function NotificationBell(props: { unreadCount: number }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const list = useFetcher<typeof notificationsLoader>();
  const live = useUnreadNotificationCount();
  const unreadCount = live?.unreadCount ?? props.unreadCount;

  // Opening the panel loads the list, which carries a fresh count too.
  const listedCount = list.data?.unreadCount;
  const setLive = live?.set;
  useEffect(() => {
    if (listedCount !== undefined) setLive?.(listedCount);
  }, [listedCount, setLive]);

  const toggle = () => {
    if (!open) list.load(NOTIFICATIONS_ENDPOINT);
    setOpen((o) => !o);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={`Notifications, ${unreadCount} unread`}
        className={cn(
          "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium hover:bg-accent",
          unreadCount > 0 &&
            "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300"
        )}
      >
        <Bell className="size-4" />
        {unreadCount > 0 && <span>{unreadCount} new</span>}
      </button>

      {open && (
        <NotificationPanel
          unread={list.data?.notifications ?? []}
          earlier={list.data?.earlier ?? []}
          loading={list.state === "loading" && !list.data}
          onOpen={close}
        />
      )}
    </div>
  );
}

/** The sticky bar across the top of the page that holds the bell. */
export function TopBar({ unreadCount }: { unreadCount: number }) {
  return (
    <div className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-end border-b bg-background/95 px-6 backdrop-blur">
      <UnreadNotificationCountProvider initialCount={unreadCount}>
        <NotificationBell unreadCount={unreadCount} />
      </UnreadNotificationCountProvider>
    </div>
  );
}
