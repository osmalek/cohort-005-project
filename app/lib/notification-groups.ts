import { NotificationKind } from "~/db/schema";

// How the bell's panel groups unread Notifications by kind. Shared by the
// Notifications module (Clear on a group) and the bell component (rendering),
// so both agree on which kinds a group holds.

/** Which kinds each group holds, keyed by group. */
const KINDS_BY_GROUP = {
  comments: [
    NotificationKind.CommentReply,
    NotificationKind.InstructorQuestion,
  ],
  lessons: [NotificationKind.NewLesson],
  refunds: [NotificationKind.RefundDecided],
} as const satisfies Record<string, readonly NotificationKind[]>;

export type NotificationGroupKey = keyof typeof KINDS_BY_GROUP;

export type NotificationGroup = {
  key: NotificationGroupKey;
  label: string;
  kinds: readonly NotificationKind[];
};

/** The groups in the order the panel shows them. */
export const NOTIFICATION_GROUPS: readonly NotificationGroup[] = [
  {
    key: "comments",
    label: "Comments & replies",
    kinds: KINDS_BY_GROUP.comments,
  },
  { key: "lessons", label: "New lessons", kinds: KINDS_BY_GROUP.lessons },
  { key: "refunds", label: "Refunds", kinds: KINDS_BY_GROUP.refunds },
];

/** What Clear can target: one group, or everything on the bell. */
export type ClearTarget = NotificationGroupKey | "all";

export const CLEAR_TARGETS: [ClearTarget, ...ClearTarget[]] = [
  "all",
  ...NOTIFICATION_GROUPS.map((g) => g.key),
];

export function kindsInGroup(key: NotificationGroupKey): NotificationKind[] {
  return [...KINDS_BY_GROUP[key]];
}

/**
 * Whether a Notification counts toward the bell's unread count: unread and
 * not cleared. A cleared but unread one (in "See earlier") is already out of
 * the count, so opening it must not lower the count again.
 */
export function isOnBell(notification: {
  readAt: string | null;
  hiddenAt: string | null;
}): boolean {
  return notification.readAt === null && notification.hiddenAt === null;
}
