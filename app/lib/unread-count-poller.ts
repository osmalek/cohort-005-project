// Keeps the bell's unread Notification count current without a reload.
//
// - Polls `fetchCount` every `intervalMs` while the tab is visible.
// - Makes no requests while the tab is hidden.
// - Refreshes straight away when the tab becomes visible again.
// - `adjust`/`set` apply local changes (mark-read, Clear) immediately. A poll
//   that was already in flight when the count changed locally is discarded,
//   so a stale server answer cannot undo them.
//
// Framework-free so it can be tested with fake timers. The React wrapper is
// app/hooks/use-unread-notification-count.tsx.

export interface VisibilitySource {
  isVisible(): boolean;
  /** Subscribe to visibility changes; returns an unsubscribe function. */
  onChange(listener: () => void): () => void;
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

/** The browser's `document` as a VisibilitySource. */
export function documentVisibility(doc: Document = document): VisibilitySource {
  return {
    isVisible: () => doc.visibilityState === "visible",
    onChange(listener) {
      doc.addEventListener("visibilitychange", listener);
      return () => doc.removeEventListener("visibilitychange", listener);
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
  let unsubscribe: (() => void) | null = null;

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
    opts.fetchCount().then(
      (n) => {
        if (mine === generation && n !== count) write(n);
      },
      () => {
        // Keep the last known count; the next poll will try again.
      }
    );
  }

  const onVisibilityChange = () => {
    if (opts.visibility.isVisible()) {
      refresh();
      startTimer();
    } else {
      stopTimer();
    }
  };

  return {
    start() {
      if (unsubscribe) return;
      unsubscribe = opts.visibility.onChange(onVisibilityChange);
      if (opts.visibility.isVisible()) startTimer();
    },
    stop() {
      stopTimer();
      unsubscribe?.();
      unsubscribe = null;
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
