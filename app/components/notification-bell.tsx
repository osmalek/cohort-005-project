import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Bell, BookOpen, MessageCircle, Receipt, Reply } from "lucide-react";
import { cn } from "~/lib/utils";
import { NotificationKind } from "~/db/schema";
import type { NotificationView } from "~/lib/notifications.server";
import type { loader as notificationsLoader } from "~/routes/api.notifications";

// The Notification bell in the top bar (Variant C of the prototype). The
// count comes from the app layout's loader, so it refreshes whenever the page
// revalidates (e.g. after marking a Notification read). The list loads from
// /api/notifications only when the bell is opened.

export const NOTIFICATIONS_ENDPOINT = "/api/notifications";

/** Short relative time: "just now", "5m", "3h", "2d". */
function ago(iso: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 60 / 24)}d`;
}

function KindIcon({ kind, className }: { kind: NotificationKind; className?: string }) {
  const c = cn("size-4 shrink-0", className);
  switch (kind) {
    case NotificationKind.CommentReply:
      return <Reply className={c} />;
    case NotificationKind.InstructorQuestion:
      return <MessageCircle className={c} />;
    case NotificationKind.NewLesson:
      return <BookOpen className={c} />;
    case NotificationKind.RefundDecided:
      return <Receipt className={c} />;
  }
}

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

function NotificationRow({
  notification,
  onOpen,
}: {
  notification: NotificationView;
  onOpen: () => void;
}) {
  const fetcher = useFetcher();
  return (
    <fetcher.Form
      method="post"
      action={NOTIFICATIONS_ENDPOINT}
      onSubmit={onOpen}
    >
      <input type="hidden" name="intent" value="mark-read" />
      <input type="hidden" name="notificationId" value={notification.id} />
      <button
        type="submit"
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-accent"
      >
        <KindIcon kind={notification.kind} className="text-muted-foreground" />
        <span className="min-w-0 flex-1 text-sm">{notification.text}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {ago(notification.createdAt, Date.now())}
        </span>
      </button>
    </fetcher.Form>
  );
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

  const notifications = list.data?.notifications ?? [];

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
        <div className="absolute right-0 top-11 z-50 w-[min(34rem,calc(100vw-2rem))] rounded-xl border bg-popover p-2 text-popover-foreground shadow-2xl">
          <div className="px-3 py-2 font-semibold">Inbox</div>
          {list.state === "loading" && !list.data ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground">
              <Bell className="size-6 opacity-40" />
              You're all caught up
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto">
              {notifications.map((n) => (
                <NotificationRow key={n.id} notification={n} onOpen={close} />
              ))}
            </div>
          )}
        </div>
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
