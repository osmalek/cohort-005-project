// Keeps the bell's unread Notification count current without a reload.
//
// - Polls `fetchCount` every `intervalMs` while the tab is visible.
// - Makes no requests while the tab is hidden.
// - Refreshes straight away when the tab becomes visible again, or when the
//   window regains focus. Switching back to a tab usually fires both at once,
//   so a refresh from either is skipped while a fetch is in flight or one
//   started within the last `EVENT_REFRESH_DEDUPE_MS`.
// - `adjust`/`set` apply local changes (mark-read, Clear) immediately. A poll
//   that was already in flight when the count changed locally is discarded,
//   so a stale server answer cannot undo them.
//
// Framework-free so it can be tested with fake timers. The React wrapper is
// app/hooks/use-unread-notification-count.tsx.

/** How close together a visibility and a focus refresh count as one. */
export const EVENT_REFRESH_DEDUPE_MS = 2_000;

export interface VisibilitySource {
  isVisible(): boolean;
  /** Subscribe to visibility changes; returns an unsubscribe function. */
  onChange(listener: () => void): () => void;
  /** Subscribe to the window regaining focus; returns an unsubscribe function. */
  onFocus(listener: () => void): () => void;
}

export interface UnreadCountPollerOptions {
  initialCount: number;
  intervalMs: number;
  fetchCount: () => Promise<number>;
  visibility: VisibilitySource;
  onCount: (count: number) => void;
}

export interface UnreadCountPoller {
  start(): void;
  stop(): void;
  /** Fetch the count now (no-op while hidden). */
  refresh(): void;
  /** Change the count locally by `delta`, e.g. -1 after a mark-read. */
  adjust(delta: number): void;
  /** Replace the count locally, e.g. 0 after Clear all. */
  set(count: number): void;
  getCount(): number;
}

/** The browser's `document` and `window` as a VisibilitySource. */
export function documentVisibility(
  doc: Document = document,
  win: Window = window
): VisibilitySource {
  return {
    isVisible: () => doc.visibilityState === "visible",
    onChange(listener) {
      doc.addEventListener("visibilitychange", listener);
      return () => doc.removeEventListener("visibilitychange", listener);
    },
    onFocus(listener) {
      win.addEventListener("focus", listener);
      return () => win.removeEventListener("focus", listener);
    },
  };
}

export function createUnreadCountPoller(
  opts: UnreadCountPollerOptions
): UnreadCountPoller {
  let count = Math.max(0, opts.initialCount);
  // Bumped on every local change and every new poll, so only the latest
  // poll started after the latest local change may write the count.
  let generation = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let unsubscribers: (() => void)[] = [];
  let inFlight = 0;
  let lastFetchStartedAt = Number.NEGATIVE_INFINITY;

  const write = (next: number) => {
    next = Math.max(0, next);
    count = next;
    opts.onCount(next);
  };

  const startTimer = () => {
    if (timer === null) timer = setInterval(refresh, opts.intervalMs);
  };
  const stopTimer = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };

  function refresh() {
    if (!opts.visibility.isVisible()) return;
    const mine = ++generation;
    inFlight++;
    lastFetchStartedAt = Date.now();
    opts
      .fetchCount()
      .then(
        (n) => {
          if (mine === generation && n !== count) write(n);
        },
        () => {
          // Keep the last known count; the next poll will try again.
        }
      )
      .finally(() => {
        inFlight--;
      });
  }

  /** A refresh triggered by the tab coming back; deduped (see the header). */
  const refreshOnReturn = () => {
    if (inFlight > 0) return;
    if (Date.now() - lastFetchStartedAt < EVENT_REFRESH_DEDUPE_MS) return;
    refresh();
  };

  const onVisibilityChange = () => {
    if (opts.visibility.isVisible()) {
      refreshOnReturn();
      startTimer();
    } else {
      stopTimer();
    }
  };

  return {
    start() {
      if (unsubscribers.length > 0) return;
      unsubscribers = [
        opts.visibility.onChange(onVisibilityChange),
        opts.visibility.onFocus(refreshOnReturn),
      ];
      if (opts.visibility.isVisible()) startTimer();
    },
    stop() {
      stopTimer();
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      unsubscribers = [];
      generation++;
    },
    refresh,
    adjust(delta) {
      generation++;
      write(count + delta);
    },
    set(next) {
      generation++;
      write(next);
    },
    getCount: () => count,
  };
}
