import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Bell } from "lucide-react";
import { cn } from "~/lib/utils";
import type { loader as notificationsLoader } from "~/routes/api.notifications";
import {
  NOTIFICATIONS_ENDPOINT,
  NotificationPanel,
} from "~/components/notification-panel";

// The Notification bell in the top bar (Variant C of the prototype). The
// count comes from the app layout's loader, so it refreshes whenever the page
// revalidates (e.g. after marking a Notification read). The list loads from
// /api/notifications only when the bell is opened, and is drawn by
// NotificationPanel.

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

export function NotificationBell({ unreadCount }: { unreadCount: number }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const list = useFetcher<typeof notificationsLoader>();

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
      <NotificationBell unreadCount={unreadCount} />
    </div>
  );
}
