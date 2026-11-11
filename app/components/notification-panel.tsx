import { useState } from "react";
import { useFetcher } from "react-router";
import { Bell, BookOpen, MessageCircle, Receipt, Reply } from "lucide-react";
import { cn } from "~/lib/utils";
import { NotificationKind } from "~/db/schema";
import {
  NOTIFICATION_GROUPS,
  type ClearTarget,
} from "~/lib/notification-groups";
import type { NotificationView } from "~/lib/notifications.server";
import { useUnreadNotificationCount } from "~/hooks/use-unread-notification-count";

// The bell's panel (Variant C of the prototype): unread Notifications grouped
// by kind, each group with its own Clear, a Clear all, and a collapsed
// "See earlier" section of read and cleared Notifications. It only renders;
// the bell loads the data and owns opening and closing.

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

function NotificationRow({
  notification,
  dim,
  onOpen,
}: {
  notification: NotificationView;
  dim?: boolean;
  onOpen: () => void;
}) {
  const fetcher = useFetcher();
  const live = useUnreadNotificationCount();
  return (
    <fetcher.Form
      method="post"
      action={NOTIFICATIONS_ENDPOINT}
      onSubmit={() => {
        if (!notification.readAt) live?.adjust(-1);
        onOpen();
      }}
    >
      <input type="hidden" name="intent" value="mark-read" />
      <input type="hidden" name="notificationId" value={notification.id} />
      <button
        type="submit"
        className={cn(
          "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-accent",
          dim && "opacity-60"
        )}
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

/**
 * A "Clear" button that hides one group, or everything, from the bell. The
 * live count drops at once; the next poll reconciles it.
 */
function ClearButton({
  target,
  count,
  label,
  className,
}: {
  target: ClearTarget;
  /** How many unread Notifications this clears. */
  count: number;
  label: string;
  className?: string;
}) {
  const fetcher = useFetcher();
  const live = useUnreadNotificationCount();
  return (
    <fetcher.Form
      method="post"
      action={NOTIFICATIONS_ENDPOINT}
      onSubmit={() => {
        if (target === "all") live?.set(0);
        else live?.adjust(-count);
      }}
    >
      <input type="hidden" name="intent" value="clear" />
      <input type="hidden" name="target" value={target} />
      <button
        type="submit"
        disabled={fetcher.state !== "idle"}
        className={cn("text-xs disabled:opacity-50", className)}
      >
        {label}
      </button>
    </fetcher.Form>
  );
}

export function NotificationPanel({
  unread,
  earlier,
  loading,
  onOpen,
}: {
  unread: NotificationView[];
  earlier: NotificationView[];
  loading: boolean;
  /** Called when a Notification is clicked (the bell closes itself). */
  onOpen: () => void;
}) {
  const [showEarlier, setShowEarlier] = useState(false);

  return (
    <div className="absolute right-0 top-11 z-50 w-[min(34rem,calc(100vw-2rem))] rounded-xl border bg-popover p-2 text-popover-foreground shadow-2xl">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="font-semibold">Inbox</span>
        {unread.length > 0 && (
          <ClearButton
            target="all"
            count={unread.length}
            label="Clear all"
            className="font-medium text-primary hover:underline"
          />
        )}
      </div>

      {loading ? (
        <div className="px-3 py-6 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto">
          {unread.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground">
              <Bell className="size-6 opacity-40" />
              You're all caught up
            </div>
          )}

          {NOTIFICATION_GROUPS.map((group) => {
            const kinds: readonly NotificationKind[] = group.kinds;
            const items = unread.filter((n) => kinds.includes(n.kind));
            if (items.length === 0) return null;
            return (
              <section key={group.key} aria-label={group.label} className="mb-1">
                <div className="flex items-center justify-between px-3 pb-1 pt-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.label} · {items.length}
                  </span>
                  <ClearButton
                    target={group.key}
                    count={items.length}
                    label="Clear"
                    className="text-muted-foreground hover:text-foreground"
                  />
                </div>
                {items.map((n) => (
                  <NotificationRow key={n.id} notification={n} onOpen={onOpen} />
                ))}
              </section>
            );
          })}

          {earlier.length > 0 && (
            <div className="mt-1 border-t pt-1">
              <button
                type="button"
                aria-expanded={showEarlier}
                onClick={() => setShowEarlier((s) => !s)}
                className="w-full px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                {showEarlier ? "Hide" : "See"} earlier ({earlier.length})
              </button>
              {showEarlier &&
                earlier.map((n) => (
                  <NotificationRow key={n.id} notification={n} dim onOpen={onOpen} />
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
