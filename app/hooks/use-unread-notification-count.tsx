import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { z } from "zod";
import {
  createUnreadCountPoller,
  documentVisibility,
  type UnreadCountPoller,
} from "~/lib/unread-count-poller";

// The bell's live unread count, shared through context so anything in the
// panel (mark-read, Clear, Clear all) can update it straight away:
//
//   const { adjust, set } = useUnreadNotificationCount();
//   adjust(-cleared);   // after clearing some
//   set(0);             // after Clear all
//
// Other open tabs catch up on their next poll.

export const NOTIFICATIONS_COUNT_ENDPOINT = "/api/notifications/count";
export const NOTIFICATIONS_POLL_INTERVAL_MS = 60_000;

export interface UnreadNotificationCount {
  unreadCount: number;
  /** Change the count locally by `delta`, e.g. -1 after a mark-read. */
  adjust: (delta: number) => void;
  /** Replace the count locally, e.g. 0 after Clear all. */
  set: (count: number) => void;
  /** Re-fetch the count from the server now. */
  refresh: () => void;
}

const UnreadNotificationCountContext =
  createContext<UnreadNotificationCount | null>(null);

const unreadCountResponse = z.object({
  unreadCount: z.number().int().nonnegative(),
});

async function fetchUnreadCount(): Promise<number> {
  const res = await fetch(NOTIFICATIONS_COUNT_ENDPOINT, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Count request failed: ${res.status}`);
  return unreadCountResponse.parse(await res.json()).unreadCount;
}

export function UnreadNotificationCountProvider({
  initialCount,
  children,
}: {
  /** The count from the layout loader; re-applied when the page revalidates. */
  initialCount: number;
  children: ReactNode;
}) {
  const [unreadCount, setUnreadCount] = useState(initialCount);
  const pollerRef = useRef<UnreadCountPoller | null>(null);

  useEffect(() => {
    const poller = createUnreadCountPoller({
      initialCount,
      intervalMs: NOTIFICATIONS_POLL_INTERVAL_MS,
      fetchCount: fetchUnreadCount,
      visibility: documentVisibility(),
      onCount: setUnreadCount,
    });
    pollerRef.current = poller;
    poller.start();
    return () => {
      poller.stop();
      pollerRef.current = null;
    };
    // The poller lives for the whole mount; later loader counts go through
    // the effect below instead of recreating it.
  }, []);

  // A revalidated layout loader (e.g. after a navigation) is fresh server
  // data, so it wins over whatever we had.
  useEffect(() => {
    pollerRef.current?.set(initialCount);
  }, [initialCount]);

  // Stable identities, so consumers can list them as effect dependencies.
  const actions = useMemo(
    () => ({
      adjust: (delta: number) => pollerRef.current?.adjust(delta),
      set: (count: number) => pollerRef.current?.set(count),
      refresh: () => pollerRef.current?.refresh(),
    }),
    []
  );
  const value = useMemo<UnreadNotificationCount>(
    () => ({ unreadCount, ...actions }),
    [unreadCount, actions]
  );

  return (
    <UnreadNotificationCountContext.Provider value={value}>
      {children}
    </UnreadNotificationCountContext.Provider>
  );
}

/** The live count, or null outside an UnreadNotificationCountProvider. */
export function useUnreadNotificationCount(): UnreadNotificationCount | null {
  return useContext(UnreadNotificationCountContext);
}
