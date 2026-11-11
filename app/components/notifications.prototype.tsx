// PROTOTYPE — throwaway. "Prototype: the Notification bell and inbox UI"
// (https://github.com/osmalek/cohort-005-project/issues/5).
//
// Three variants of the Notification bell + inbox in the existing app shell,
// switchable via `?variant=A|B|C` on any page under the app layout:
//   A — Bell in the sidebar header, compact popover, items stay (dimmed) when read.
//   B — "Notifications" sidebar nav item, full-height slide-over drawer with
//       Unread/All tabs, grouped by day, per-row read/unread toggle.
//   C — Bell in a new top bar over the page, wide panel grouped by kind,
//       inbox-zero: read items leave the list ("See earlier" shows history).
//
// Read state is in-memory only (stubbed mutations). "Simulate poll" on the
// switcher stands in for the 60 s unread-count poll bringing in a new one.
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  Bell,
  BookOpen,
  Check,
  CheckCheck,
  Circle,
  CircleDot,
  MessageCircle,
  Reply,
  Receipt,
  X,
} from "lucide-react";
import { cn } from "~/lib/utils";
import type {
  ProtoNotification,
  ProtoNotificationKind,
} from "~/lib/notifications.prototype.server";
import { PrototypeSwitcher } from "~/components/prototype-switcher";

// ---------- shared state (stubbed mutations) ----------

function useProtoNotifications(initial: ProtoNotification[]) {
  const [items, setItems] = useState(initial);
  const [pulse, setPulse] = useState(0);
  // Loader revalidates on every navigation; only reset when the user switches.
  const identity = initial.map((n) => n.text).join("|");
  useEffect(() => setItems(initial), [identity]);
  const unread = items.filter((n) => !n.read).length;
  return {
    items,
    unread,
    pulse,
    setRead: (id: number, read: boolean) =>
      setItems((xs) => xs.map((n) => (n.id === id ? { ...n, read } : n))),
    markAllRead: (ids?: number[]) =>
      setItems((xs) =>
        xs.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n))
      ),
    simulatePoll: () => {
      setItems((xs) => {
        if (xs.length === 0) return xs;
        const tpl = xs[Math.floor(Math.random() * xs.length)];
        const nextId = Math.max(...xs.map((n) => n.id)) + 1;
        return [{ ...tpl, id: nextId, minutesAgo: 0, read: false }, ...xs];
      });
      setPulse((p) => p + 1);
    },
  };
}
type Store = ReturnType<typeof useProtoNotifications>;

function ago(m: number) {
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 60 / 24)}d`;
}

function KindIcon({ n, className }: { n: ProtoNotification; className?: string }) {
  const c = cn("size-4 shrink-0", className);
  switch (n.kind) {
    case "comment_reply":
      return <Reply className={c} />;
    case "instructor_comment":
      return <MessageCircle className={c} />;
    case "lesson_published":
      return <BookOpen className={c} />;
    case "refund_decided":
      return (
        <Receipt
          className={cn(
            c,
            n.refundOutcome === "approved" ? "text-emerald-600" : "text-rose-600"
          )}
        />
      );
  }
}

function CountBadge({ count, className }: { count: number; className?: string }) {
  if (count === 0) return null;
  return (
    <span
      className={cn(
        "flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-none text-white",
        className
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

function EmptyState({ text = "No Notifications yet" }: { text?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground">
      <Bell className="size-6 opacity-40" />
      {text}
    </div>
  );
}

/** Navigate but keep ?variant= so the chosen variant survives the click. */
function useGo() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  return (href: string) => {
    const [path, hash] = href.split("#");
    const v = params.get("variant");
    nav(path + (v ? `?variant=${v}` : "") + (hash ? `#${hash}` : ""));
  };
}

// ---------- Variant A: sidebar-header bell + compact popover ----------

function VariantABell({ store }: { store: Store }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useDismiss(open, close);
  const navigate = useGo();

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        aria-label={`Notifications, ${store.unread} unread`}
      >
        <Bell key={store.pulse} className={cn("size-5", store.pulse && "animate-bounce [animation-iteration-count:2]")} />
        <CountBadge count={store.unread} className="absolute -right-0.5 -top-0.5" />
      </button>
      {open && (
        <div className="absolute left-0 top-10 z-50 w-96 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <span className="font-semibold">Notifications</span>
            <button
              disabled={store.unread === 0}
              onClick={() => store.markAllRead()}
              className="text-xs font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
            >
              Mark all as read
            </button>
          </div>
          {store.items.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="max-h-[28rem] divide-y overflow-y-auto">
              {store.items.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => {
                      store.setRead(n.id, true);
                      close();
                      navigate(n.href);
                    }}
                    className={cn(
                      "flex w-full gap-3 px-4 py-3 text-left hover:bg-accent",
                      !n.read && "bg-primary/5"
                    )}
                  >
                    <KindIcon n={n} className="mt-0.5 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className={cn("text-sm", n.read ? "text-muted-foreground" : "font-medium")}>
                        {n.text}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{ago(n.minutesAgo)}</div>
                    </div>
                    {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t px-4 py-2 text-center text-xs text-muted-foreground">
            Clicking opens it and marks it read
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Variant B: sidebar nav item + slide-over drawer ----------

function dayGroup(m: number) {
  if (m < 60 * 24) return "Today";
  if (m < 60 * 24 * 7) return "This week";
  return "Earlier";
}

function VariantBNavItem({ store, onOpen, active }: { store: Store; onOpen: () => void; active: boolean }) {
  return (
    <button
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      )}
    >
      <Bell className="size-4" />
      Notifications
      <CountBadge count={store.unread} className="ml-auto h-5 min-w-5 text-[11px]" />
    </button>
  );
}

function VariantBDrawer({ store, open, onClose }: { store: Store; open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"unread" | "all">("unread");
  const navigate = useGo();
  if (!open) return null;
  const shown = store.items.filter((n) => tab === "all" || !n.read);
  const groups = ["Today", "This week", "Earlier"]
    .map((g) => ({ g, xs: shown.filter((n) => dayGroup(n.minutesAgo) === g) }))
    .filter((x) => x.xs.length > 0);

  return (
    <>
      <div className="fixed inset-0 left-56 z-40 bg-black/30" onClick={onClose} />
      <aside className="fixed bottom-0 left-56 top-0 z-50 flex w-[28rem] flex-col border-r bg-background shadow-2xl">
        <div className="flex h-14 items-center justify-between border-b px-5">
          <h2 className="text-lg font-semibold">Notifications</h2>
          <div className="flex items-center gap-1">
            <button
              disabled={store.unread === 0}
              onClick={() => store.markAllRead()}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-40"
            >
              <CheckCheck className="size-4" /> Mark all read
            </button>
            <button onClick={onClose} className="rounded-md p-1 hover:bg-accent" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
        </div>
        <div className="flex gap-4 border-b px-5">
          {(["unread", "all"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "-mb-px border-b-2 py-2.5 text-sm font-medium capitalize",
                tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground"
              )}
            >
              {t}
              {t === "unread" && store.unread > 0 && ` (${store.unread})`}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {groups.length === 0 && (
            <EmptyState text={tab === "unread" ? "No unread Notifications" : undefined} />
          )}
          {groups.map(({ g, xs }) => (
            <section key={g}>
              <div className="sticky top-0 bg-muted/80 px-5 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
                {g}
              </div>
              {xs.map((n) => (
                <div key={n.id} className="group flex items-start gap-3 border-b px-5 py-3 hover:bg-accent/60">
                  <div className="mt-0.5 rounded-full bg-muted p-2">
                    <KindIcon n={n} />
                  </div>
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      store.setRead(n.id, true);
                      onClose();
                      navigate(n.href);
                    }}
                  >
                    <div className={cn("text-sm", !n.read && "font-semibold")}>{n.text}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {n.courseTitle} · {ago(n.minutesAgo)}
                    </div>
                  </button>
                  <button
                    onClick={() => store.setRead(n.id, !n.read)}
                    title={n.read ? "Mark as unread" : "Mark as read"}
                    className="rounded-full p-1 text-primary opacity-70 hover:bg-background group-hover:opacity-100"
                  >
                    {n.read ? <Circle className="size-3.5 text-muted-foreground" /> : <CircleDot className="size-3.5" />}
                  </button>
                </div>
              ))}
            </section>
          ))}
        </div>
      </aside>
    </>
  );
}

// ---------- Variant C: top-bar bell + grouped-by-kind, inbox-zero panel ----------

const KIND_GROUPS: { label: string; kinds: ProtoNotificationKind[] }[] = [
  { label: "Comments & replies", kinds: ["comment_reply", "instructor_comment"] },
  { label: "New lessons", kinds: ["lesson_published"] },
  { label: "Refunds", kinds: ["refund_decided"] },
];

function VariantCTopBar({ store }: { store: Store }) {
  const [open, setOpen] = useState(false);
  const [showEarlier, setShowEarlier] = useState(false);
  const close = () => setOpen(false);
  const ref = useDismiss(open, close);
  const navigate = useGo();
  const unread = store.items.filter((n) => !n.read);
  const earlier = store.items.filter((n) => n.read);

  const row = (n: ProtoNotification, dim: boolean) => (
    <div key={n.id} className={cn("flex items-center gap-3 rounded-md px-3 py-2 hover:bg-accent", dim && "opacity-60")}>
      <KindIcon n={n} className="text-muted-foreground" />
      <button
        className="min-w-0 flex-1 text-left"
        onClick={() => {
          store.setRead(n.id, true);
          close();
          navigate(n.href);
        }}
      >
        <div className="truncate text-sm">{n.text}</div>
      </button>
      <span className="shrink-0 text-xs text-muted-foreground">{ago(n.minutesAgo)}</span>
      {!dim && (
        <button
          onClick={() => store.setRead(n.id, true)}
          title="Done: mark read"
          className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
        >
          <Check className="size-4" />
        </button>
      )}
    </div>
  );

  return (
    <div className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-end border-b bg-background/95 px-6 backdrop-blur">
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium hover:bg-accent",
            store.unread > 0 && "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300"
          )}
          aria-label={`Notifications, ${store.unread} unread`}
        >
          <Bell key={store.pulse} className={cn("size-4", store.pulse && "animate-bounce [animation-iteration-count:2]")} />
          {store.unread > 0 ? `${store.unread} new` : "All caught up"}
        </button>
        {open && (
          <div className="absolute right-0 top-11 z-50 w-[34rem] rounded-xl border bg-popover p-2 text-popover-foreground shadow-2xl">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="font-semibold">Inbox</span>
              {unread.length > 0 && (
                <button onClick={() => store.markAllRead()} className="text-xs font-medium text-primary hover:underline">
                  Clear all
                </button>
              )}
            </div>
            {unread.length === 0 && <EmptyState text="You're all caught up" />}
            {KIND_GROUPS.map(({ label, kinds }) => {
              const xs = unread.filter((n) => kinds.includes(n.kind));
              if (xs.length === 0) return null;
              return (
                <section key={label} className="mb-1">
                  <div className="flex items-center justify-between px-3 pb-1 pt-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {label} · {xs.length}
                    </span>
                    <button
                      onClick={() => store.markAllRead(xs.map((n) => n.id))}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  </div>
                  {xs.map((n) => row(n, false))}
                </section>
              );
            })}
            {earlier.length > 0 && (
              <div className="mt-1 border-t pt-1">
                <button
                  onClick={() => setShowEarlier((s) => !s)}
                  className="w-full px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  {showEarlier ? "Hide" : "See"} earlier ({earlier.length})
                </button>
                {showEarlier && <div className="max-h-56 overflow-y-auto">{earlier.map((n) => row(n, true))}</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- wiring ----------

const VARIANTS = [
  { key: "A", name: "Sidebar bell + popover" },
  { key: "B", name: "Nav item + drawer" },
  { key: "C", name: "Top bar + inbox-zero" },
];

/** Returns the slots the app layout drops into its existing structure. */
export function useNotificationsPrototype(initial: ProtoNotification[], enabled: boolean) {
  const [params] = useSearchParams();
  const variant = params.get("variant") ?? "A";
  const store = useProtoNotifications(initial);
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (!enabled) return { sidebarHeader: null, sidebarNav: null, topBar: null, overlay: null };

  return {
    sidebarHeader: variant === "A" ? <VariantABell store={store} /> : null,
    sidebarNav:
      variant === "B" ? (
        <VariantBNavItem store={store} active={drawerOpen} onOpen={() => setDrawerOpen((o) => !o)} />
      ) : null,
    topBar: variant === "C" ? <VariantCTopBar store={store} /> : null,
    overlay: (
      <>
        {variant === "B" && (
          <VariantBDrawer store={store} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
        )}
        <PrototypeSwitcher
          variants={VARIANTS}
          extra={
            <>
              <span className="border-l border-white/20 pl-2 text-xs text-white/70" data-testid="proto-state">
                unread {store.unread} / {store.items.length}
              </span>
              <button
                onClick={store.simulatePoll}
                className="rounded-full bg-white/10 px-2 py-0.5 text-xs hover:bg-white/20"
                title="Stand-in for the 60 s unread-count poll finding a new Notification"
              >
                Simulate poll +1
              </button>
            </>
          }
        />
      </>
    ),
  };
}
