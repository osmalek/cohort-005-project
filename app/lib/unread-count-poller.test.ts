import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUnreadCountPoller } from "./unread-count-poller";

// A stand-in for `document`'s visibility and the window's focus: tests flip
// visibility, or focus the window, and fire the events.
function fakeVisibility(initiallyVisible = true) {
  let visible = initiallyVisible;
  const listeners = new Set<() => void>();
  const focusListeners = new Set<() => void>();
  return {
    isVisible: () => visible,
    onChange(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onFocus(listener: () => void) {
      focusListeners.add(listener);
      return () => focusListeners.delete(listener);
    },
    set(next: boolean) {
      visible = next;
      listeners.forEach((l) => l());
    },
    focus() {
      focusListeners.forEach((l) => l());
    },
  };
}

function setup(opts: { initialCount?: number; visible?: boolean } = {}) {
  const visibility = fakeVisibility(opts.visible ?? true);
  let serverCount = 0;
  const fetchCount = vi.fn(async () => serverCount);
  const counts: number[] = [];
  const poller = createUnreadCountPoller({
    initialCount: opts.initialCount ?? 0,
    intervalMs: 60_000,
    fetchCount,
    visibility,
    onCount: (n) => counts.push(n),
  });
  return {
    poller,
    visibility,
    fetchCount,
    counts,
    setServerCount: (n: number) => {
      serverCount = n;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("unread Notification count poller", () => {
  it("picks up a new Notification within 60 seconds while the tab is visible", async () => {
    const t = setup({ initialCount: 1 });
    t.poller.start();
    expect(t.fetchCount).not.toHaveBeenCalled();

    t.setServerCount(2);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(t.fetchCount).toHaveBeenCalledTimes(1);
    expect(t.poller.getCount()).toBe(2);
    expect(t.counts).toEqual([2]);
  });

  it("keeps polling every 60 seconds", async () => {
    const t = setup();
    t.poller.start();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(t.fetchCount).toHaveBeenCalledTimes(3);
  });

  it("makes no count requests while the tab is hidden", async () => {
    const t = setup();
    t.poller.start();
    t.visibility.set(false);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(t.fetchCount).not.toHaveBeenCalled();
  });

  it("does not poll when started in a hidden tab", async () => {
    const t = setup({ visible: false });
    t.poller.start();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(t.fetchCount).not.toHaveBeenCalled();
  });

  it("refreshes straight away when the tab becomes visible again, then resumes polling", async () => {
    const t = setup();
    t.poller.start();
    t.visibility.set(false);
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    t.setServerCount(4);
    t.visibility.set(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.fetchCount).toHaveBeenCalledTimes(1);
    expect(t.poller.getCount()).toBe(4);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.fetchCount).toHaveBeenCalledTimes(2);
  });

  it("refreshes straight away when the window regains focus", async () => {
    const t = setup({ initialCount: 1 });
    t.poller.start();

    t.setServerCount(3);
    t.visibility.focus();
    await vi.advanceTimersByTimeAsync(0);

    expect(t.fetchCount).toHaveBeenCalledTimes(1);
    expect(t.poller.getCount()).toBe(3);
  });

  it("fetches once when the tab becomes visible and the window gains focus together", async () => {
    const t = setup();
    t.poller.start();
    t.visibility.set(false);

    t.visibility.set(true);
    await vi.advanceTimersByTimeAsync(0); // the first count has already arrived
    t.visibility.focus();
    await vi.advanceTimersByTimeAsync(0);

    expect(t.fetchCount).toHaveBeenCalledTimes(1);
  });

  it("does not start a second fetch on focus while one is still in flight", async () => {
    const t = setup();
    let resolve: (n: number) => void = () => {};
    t.fetchCount.mockImplementationOnce(
      () => new Promise<number>((r) => (resolve = r))
    );
    t.poller.start();
    t.visibility.focus();
    await vi.advanceTimersByTimeAsync(10_000);
    t.visibility.focus();

    expect(t.fetchCount).toHaveBeenCalledTimes(1);
    resolve(0);
  });

  it("refreshes on focus again once the last fetch is a while ago", async () => {
    const t = setup();
    t.poller.start();
    t.visibility.focus();
    await vi.advanceTimersByTimeAsync(5_000);
    t.visibility.focus();
    await vi.advanceTimersByTimeAsync(0);

    expect(t.fetchCount).toHaveBeenCalledTimes(2);
  });

  it("ignores focus in a hidden tab", async () => {
    const t = setup({ visible: false });
    t.poller.start();
    t.visibility.focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.fetchCount).not.toHaveBeenCalled();
  });

  it("stops polling and listening once stopped", async () => {
    const t = setup();
    t.poller.start();
    t.poller.stop();
    t.visibility.set(false);
    t.visibility.set(true);
    t.visibility.focus();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(t.fetchCount).not.toHaveBeenCalled();
  });

  it("applies a local mark-read or Clear immediately, never below zero", () => {
    const t = setup({ initialCount: 3 });
    t.poller.adjust(-1);
    expect(t.poller.getCount()).toBe(2);
    t.poller.adjust(-5);
    expect(t.poller.getCount()).toBe(0);
    t.poller.set(7);
    expect(t.poller.getCount()).toBe(7);
    expect(t.counts).toEqual([2, 0, 7]);
  });

  it("ignores a poll response that was in flight when the count changed locally", async () => {
    const t = setup({ initialCount: 3 });
    let resolve: (n: number) => void = () => {};
    t.fetchCount.mockImplementationOnce(
      () => new Promise<number>((r) => (resolve = r))
    );
    t.poller.start();
    await vi.advanceTimersByTimeAsync(60_000);

    t.poller.set(0); // e.g. Clear all
    resolve(3); // stale server answer from before the Clear
    await vi.advanceTimersByTimeAsync(0);

    expect(t.poller.getCount()).toBe(0);
  });

  it("keeps the last count when a poll fails", async () => {
    const t = setup({ initialCount: 2 });
    t.fetchCount.mockRejectedValueOnce(new Error("offline"));
    t.poller.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.poller.getCount()).toBe(2);
  });
});
