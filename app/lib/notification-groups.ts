import { NotificationKind } from "~/db/schema";

// How the bell's panel groups unread Notifications by kind. Shared by the
// Notifications module (Clear on a group) and the bell component (rendering),
// so both agree on which kinds a group holds.

export const NOTIFICATION_GROUPS = [
  {
    key: "comments",
    label: "Comments & replies",
    kinds: [NotificationKind.CommentReply, NotificationKind.InstructorQuestion],
  },
  {
    key: "lessons",
    label: "New lessons",
    kinds: [NotificationKind.NewLesson],
  },
  {
    key: "refunds",
    label: "Refunds",
    kinds: [NotificationKind.RefundDecided],
  },
] as const satisfies readonly {
  key: string;
  label: string;
  kinds: readonly NotificationKind[];
}[];

export type NotificationGroupKey = (typeof NOTIFICATION_GROUPS)[number]["key"];

/** What Clear can target: one group, or everything on the bell. */
export type ClearTarget = NotificationGroupKey | "all";

export const CLEAR_TARGETS: [ClearTarget, ...ClearTarget[]] = [
  "all",
  ...NOTIFICATION_GROUPS.map((g) => g.key),
];

export function kindsInGroup(key: NotificationGroupKey): NotificationKind[] {
  return [...NOTIFICATION_GROUPS.find((g) => g.key === key)!.kinds];
}
