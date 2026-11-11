# In-app Notification feed: vendors vs homegrown

**Accessed:** 2026-11-11. All claims are cited inline; numbered references are listed under [Sources](#sources).
**Scope:** in-app channel only and event-driven only. Recipients are Students and Instructors: thousands of Students and low hundreds of Instructors, roughly 5,000 recipients and 20–50k Notifications a month.
**Stack:** React Router 8 (framework mode), Drizzle on SQLite (better-sqlite3), one Node server. Postmark is already called with plain `fetch`.

Figures marked **unverified** could not be confirmed on a primary source. Nothing in this file is taken from memory.

## TL;DR

- **Build it in-house first.** Cadence needs one channel and a few event types for about 5,000 recipients. A `notifications` table, a loader, two actions and 30–60 s polling cover that in roughly 2–4 dev-days, with no recurring cost, no user sync and no data leaving our SQLite. No vendor feature we need justifies $50–$600 a month plus an extra auth path.
- **Novu Cloud is the cheapest vendor and the only one with EU on every plan.** It bills per workflow run (one per subscriber). 20k runs fit inside Pro "from $30/mo", and 50k comes to about $54. EU (Frankfurt) is available on all plans, including Free [N1][N2][N3]. The Free tier **hard-blocks** with HTTP 402 at 10k runs [N3].
- **Knock and MagicBell both land at about $250 a month** at our volume, because their free tiers are 10k messages and 1k deliveries respectively [K1][M1]. Knock has **no EU region yet**, only "expected … by the end of 2026" [K2]. MagicBell's pricing page says nothing about data residency [M1].
- **Courier is $100–$250 a month and includes EU on Business.** It charges $0.005 per send, and the first 10k are billed too once you move to Business [C1]. Its EU datacenter is in Ireland and needs Business or Enterprise [C2]. **Stream is the worst fit.** Its first paid tier is $499–$599 a month [S1]. It is a social activity-feed product with notification feeds attached, and unread counts are capped at 100 [S3].
- **Self-hosting Novu is legal but heavy.** The code is MIT outside `enterprise/packages` [N6]. Running it needs the API, Worker, WS and Dashboard services plus MongoDB, Redis and S3 [N4]. That stack dwarfs a single SQLite process.

## Comparison

| | Knock | Novu Cloud | Novu self-hosted | MagicBell | Courier | Stream Feeds v3 |
|---|---|---|---|---|---|---|
| React package | `@knocklabs/react` 0.15.1 [K3][npm] | `@novu/react` 3.19.2 [N5][npm] | same as Cloud | `@magicbell/react` 1.14.0 [M2][npm] | `@trycourier/courier-react` 9.3.5 [C3][npm] | `@stream-io/feeds-react-sdk` 1.0.23 [S2][npm] |
| Prebuilt UI / headless | both [K3][K4] | both (`<Inbox/>`, hooks) [N5][N7] | both (Inbox in Community) [N8] | prebuilt; hooks not documented [M2] | both (`useCourier`) [C3][C4] | hooks; no prebuilt UI documented [S2] |
| States | seen, read, interacted, archived [K5] | read, seen, archived, snoozed [N7] | snooze is Cloud-only [N8] | read, seen, archived [M3] | read, opened, archived [C4] | seen, read (opt-in) [S3] |
| Real-time | vendor WebSocket [K5][K6] | WebSocket (`wss://eu.socket.novu.co`) [N2][N7] | own WS service [N4] | WebSocket (Ably connection id) [M4][npm] | `wss://realtime.eu.courier.io` [C2] | WebSocket [S2] |
| Billing unit | message = 1 user × 1 channel [K2] | workflow run = 1 subscriber [N3] | none (Community) | delivery = per channel [M1] | send = 1 recipient [C1] | activity (+ API calls) [S1][S3] |
| Free tier | 10k msgs [K1] | 10k runs, hard cap [N1][N3] | free (infra cost) | 1k deliveries [M1] | 10k sends [C1] | 5k activities [S1] |
| Est. cost, 20–50k/mo | $250 (Starter, 50k incl.) [K1] | ~$30–$54 [N1] | infra only | $249 (Startup, 50k incl.) [M1] | $100–$250 [C1] | $499 (annual) or $599 [S1] |
| EU residency | **no** (planned end-2026) [K2] | Frankfurt, all plans [N2] | wherever you host | not stated [M1] | Ireland, Business+ [C2] | Dublin listed for v2; v3 **unverified** [S4] |
| Client auth | RS256 user JWT, signed locally [K7] | HMAC-SHA256 `subscriberHash` [N9] | HMAC (assumed same; **unverified**) | HS256 user JWT, signed locally [M5] | JWT minted by an API call [C5] | server-signed user token [S2] |
| User sync needed | yes, but inline identify on trigger [K8] | auto-creates subscriber [N5] | same | **unverified** | no; `signIn` registers the user [C5] | **unverified** |

## Knock

- **UI.** `@knocklabs/react` ships `NotificationFeedPopover`, `NotificationFeed` and `NotificationIconButton`, plus "a complete set of React hooks" for headless use [K3]. In headless mode you use `useKnockClient`, `useNotifications(knockClient, channelId)` and `useNotificationStore(feed)`, and the feed client exposes `markAsSeen` and `markAllAsSeen` [K4]. The package wraps `@knocklabs/client` [K4].
- **State.** Knock stores it on each message as `seen_at`, `read_at`, `link_clicked_at` and `archived_at` [K5]. There are REST endpoints for mark-as-read, single and batch, listed in the doc index [K9]. The feed excludes archived messages by default [K5].
- **Real-time.** The client opens a WebSocket to Knock's in-app real-time service. The only event is `new-message`, which carries badge counts rather than full contents and "might be throttled" [K5]. The SDK manages the socket and offers auto-disconnect for inactive tabs [K6].
- **Pricing.** Knock bills per message, "a single message delivered to a single user on a single channel" [K1][K2]. Free covers 10k messages a month. Above that Knock does not hard-cap but "will contact you" [K1]. Starter is $250/mo with 50k included, then $0.005 per message [K1]. Stored profiles are unlimited [K1]. Enterprise can bill per notified user [K1][K2].
- **EU.** Not available. Knock says it expects to support EU data residency by the end of 2026 [K2]. The privacy policy says data is stored in the US under SCCs and the DPF [K10].
- **Fit.** `@knocklabs/node` 1.41.1 depends only on `jose` [npm]. In enhanced security mode the server signs an RS256 JWT with `sub = userId` using `signUserToken`, with no network call. The client refreshes it through `onUserTokenExpiring` [K7]. Recipients must exist in Knock before they can be notified, but you can identify them inline in the trigger body [K8]. That makes it one REST call per event, which is feasible with plain `fetch` like Postmark.

## Novu (Cloud)

- **UI.** `@novu/react` provides `<Inbox />` [N5]. Headless use goes through `useNotifications`, `useCounts` and `useNovu` [N10]. Notification actions include `read`/`unread`, `seen`, `archive`/`unarchive`, `snooze`/`unsnooze` and `delete`. Bulk actions are `readAll`, `seenAll`, `archiveAll` and `archiveAllRead` [N7]. Novu stores the state.
- **Real-time.** A WebSocket subscription updates lists automatically and can be turned off with `realtime={false}`, after which you refetch yourself [N7]. The EU socket is `wss://eu.socket.novu.co` [N2].
- **Pricing.** Novu bills per workflow run, "one execution of a workflow for one subscriber". Topic fan-out produces one run per matched subscriber. Messages, steps, channels and subscribers are not billed separately [N3]. Free gives 10k runs. **At the cap, triggers are rejected with HTTP 402** until the period resets [N3]. Pro is "from $30/month" with 30k+ runs and $1.20 per 1k extra [N1]. Estimate: 20k ≈ $30 and 50k ≈ $30 + 20 × $1.20 = **$54**. Whether Pro's base price rises in tiers is **unverified**.
- **EU.** Frankfurt, available on all plans: API `https://eu.api.novu.co/v1`, dashboard `eu.dashboard.novu.co`. API keys are bound to their region [N2]. The pricing page lists EU on Free [N1].
- **Fit.** The server SDK is `@novu/api` 3.19.1, which depends only on `zod` [npm][N11]. The client needs `subscriberHash = HMAC-SHA256(subscriberId, NOVU_SECRET_KEY)`, computed with Node's `crypto`. HMAC "is mandatory in production" [N9]. Passing an unknown `subscriberId` to the Inbox auto-creates the subscriber [N5], so no up-front sync is needed. An identifier hash is simpler than minting JWTs.

## Novu (self-hosted)

- **License.** The repo root has `LICENSE-ENTERPRISE`. It states that everything under `enterprise/packages` is under the proprietary `EE-PACKAGES-LICENSE`, and that content outside those directories is MIT [N6]. The EE license requires "prior written approval from Novu" [N6]. The enterprise packages today are `agents`, `ai`, `api`, `auth`, `billing`, `shared-services` and `translation` (GitHub API listing) [N6].
- **Required infrastructure.** The API, Worker, WS and Dashboard services, plus MongoDB, Redis and S3-compatible storage [N4]. The minimum single-VM setup is 4 vCPU and 8 GB for the services, 2 GB / 20 GB for MongoDB, and 2 GB for Redis with AOF, plus 10 GB of S3. The recommended layout is 3 VMs per service, two 8 GB Redis clusters and Atlas M20+ [N4].
- **Cloud-only features.** Inbox snooze, removing Novu branding, workflow and layout translations, SSO/MFA/RBAC, compliance certifications, and more than one team member [N8]. Bell, Inbox, Notifications and the preferences components exist in Community [N8]. Self-hosted Enterprise Edition is licensed separately and priced per contract [N3].
- **Verdict for Cadence.** We would trade one SQLite file for MongoDB, Redis, S3 and four Node services just to serve a bell.

## MagicBell

- **UI.** `@magicbell/react` provides `ContextProvider`, `Inbox`, `FloatingInbox` and toasts. The page documents no hooks [M2]. Its package depends on `reconnecting-websocket` and `magicbell-js` [npm].
- **State.** MagicBell stores read, seen and archived per notification, with `sent_at`, `read_at` and `seen_at` [M3]. The API reference lists the mark operations, but I could not read their exact paths on the page (truncated): **unverified**. The base URL is `https://api.magicbell.com/v2` [M6].
- **Real-time.** The in-app docs say MagicBell "maintains a persistent connection" [M4]. The API reference describes `connection_id` as an "Ably connection" [M6]. The transport is therefore Ably-backed WebSocket, inferred from that field and the package dependency.
- **Pricing.** MagicBell bills per delivery, counted per channel [M1]. Builder is $0 for 1k deliveries a month. Startup is **$249/mo for 50k**, then $0.0025 each [M1].
- **EU.** Not mentioned on the pricing page or in the in-app docs [M1][M4]. **Unverified / likely US-only.**
- **Fit.** The server signs an HS256 JWT with the project secret, carrying `user_email` or `user_external_id` plus `api_key`. The docs' examples use a one-year expiry [M5]. Whether users must be upserted first is **unverified** [M5].

## Courier

- **UI.** `@trycourier/courier-react` (React 18+) provides `CourierInbox`, `CourierInboxPopupMenu`, `CourierToast` and `CourierPreferences`. `useCourier()` gives you a headless client [C3]. Its actions are `readMessage`, `unreadMessage`, `openMessage`, `clickMessage`, `archiveMessage`, `unarchiveMessage` and `readAllMessages`, with counts from `totalUnreadCount` [C4].
- **State.** Courier stores read, opened and archived. They sync across devices and messages persist until archived or past `expiresAt` [C4][C6].
- **Real-time.** The client calls `listenForUpdates()` to open the realtime connection [C4]. The EU socket is `wss://realtime.eu.courier.io` and the EU inbox API is `https://inbox.eu.courier.io` [C2].
- **Pricing.** A send is one template to one recipient, all channels included, and attempts are billed even when not delivered [C1]. Developer is free up to 10k sends. Business is $0.005 per send **"including the first 10,000"** once a card is on file [C1]. Estimate: 20k = **$100**, 50k = **$250**.
- **EU.** The datacenter is in Ireland and requires **Business or Enterprise**. It is a separate workspace with its own keys and templates [C2].
- **Fit.** The server SDK is `@trycourier/courier` 10.0.0 [npm][C7]. Client JWTs are minted by **an API call**, `POST /auth/issue-token` with the scope `user_id:<id> inbox:read:messages inbox:write:events`. Set `expires_in` explicitly, because an omitted one never expires. The SDK does not refresh tokens [C5]. `signIn` registers the user, so no sync is needed [C5].

## Stream (Activity Feeds v3, not Chat)

- **UI.** `@stream-io/feeds-react-sdk` exposes hooks such as `useFeedActivities` and `useNotificationStatus`. The v3 docs describe no prebuilt UI [S2][S3]. `react-activity-feed` is the v2-era UI on the `getstream` client [npm].
- **State.** Stream stores the state. You enable `track_seen`/`track_read` on the feed group, then call `markActivity({ mark_all_read | mark_all_seen | mark_read | mark_seen })`. **Unread and unseen counts never exceed 100** [S3]. Notifications can be built-in, for reactions, comments, follows and mentions, or server-added to `notification:<user_id>` [S3].
- **Real-time.** `getOrCreate({ watch: true })` subscribes over a WebSocket. The relevant events are `feeds.notification_feed.updated` and `feeds.activity.added` [S2][S3].
- **Pricing.** Stream meters monthly API calls and activities. Build is free for 5k activities and 125k calls. Start is **$499/mo annual or $599/mo monthly** for 50k activities [S1]. Notification activities count one per recipient [S3]. A Maker account gets a $100/mo credit if the team has fewer than 5 people and revenue is under $10k/mo [S1].
- **EU.** The v2 docs list "Europe West – Ireland (`dublin`)" [S4]. The v3 equivalent and plan gating are **unverified**. The pricing page mentions only a "Dedicated Region Stack" and Enterprise regional servers [S1].
- **Fit.** The server SDK is `@stream-io/node-sdk`. Your backend signs user tokens with the API secret [S5][S2]. Stream is a social-feed engine, which is overkill for a bell.

## Homegrown sketch

**Schema.** This follows existing `app/db/schema.ts` conventions: integer ids, ISO-text timestamps and `$type<>` enums. Changing it needs the `database-migrations` skill.

```ts
export enum NotificationType {
  StudentEnrolled = "student_enrolled",     // → Instructor
  LessonCommented = "lesson_commented",     // → Instructor
  LessonPublished = "lesson_published",     // → enrolled Students
}

export const notifications = sqliteTable(
  "notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recipientId: integer("recipient_id").notNull().references(() => users.id),
    actorId: integer("actor_id").references(() => users.id),       // who caused it (nullable)
    type: text("type").notNull().$type<NotificationType>(),
    courseId: integer("course_id").references(() => courses.id),
    lessonId: integer("lesson_id").references(() => lessons.id),
    // Small JSON payload for rendering (titles snapshot), avoids N joins in the bell.
    data: text("data", { mode: "json" }).$type<Record<string, unknown>>(),
    seenAt: text("seen_at"),       // bell opened
    readAt: text("read_at"),       // item clicked / marked
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    index("notifications_recipient_created_idx").on(t.recipientId, t.createdAt),
    index("notifications_recipient_unread_idx").on(t.recipientId, t.readAt),
  ]
);
```

**Writing rows.** Add a `notifyX()` function in a service module and call it from the action that performs the event, for example enrollment, comment or lesson publish. Do the insert **in the same better-sqlite3 transaction** as the domain write so the two cannot diverge. For "new lesson → all enrolled Students", one `INSERT … SELECT user_id FROM enrollments WHERE course_id = ?` fans out without a JS loop. At 50k rows a month, synchronous inserts on SQLite are trivial. Role gating is just "Students and Instructors only", enforced when the recipients are selected.

**Reading.** Add a `notifications` loader, either in the layout route that renders the bell or in a resource route. It returns the latest N rows and `unreadCount = count(*) where recipient_id = ? and read_at is null and archived_at is null`. Poll with `useFetcher().load("/notifications")` on a 30–60 s `setInterval` plus a window-focus refresh. `useRevalidator().revalidate()` also works, but it re-runs **every** loader on the page, so a scoped fetcher is better [RR1]. Pause polling when `document.hidden`.

**Optional SSE.** A resource route has no default export, and its loader can return a `Response` [RR2]. Return a `ReadableStream` with `Content-Type: text/event-stream` that pushes `unreadCount` when an in-process `EventEmitter` fires from `notifyX()`. The client listens with `EventSource`. The docs do not cover SSE explicitly; this works because the loader can return any `Response` [RR2]. This only works because Cadence is a **single Node process**. Multiple instances would need Redis pub/sub or similar.

**Mark actions.** Use `fetcher.Form` POSTs to one action with an `intent`: `seen-all` when the bell opens, `read` with an id, `read-all`, or `archive` with an id. Each one is an `UPDATE … WHERE recipient_id = :sessionUser`, and the recipient check is the whole authorization model. A fetcher submission revalidates loaders automatically [RR2].

**Effort (estimate).** Schema, migration and seed take about 0.5 d. Service functions and three event hooks take about 0.5–1 d. Loader, actions and the bell/list UI take about 1–1.5 d. Tests take about 0.5–1 d. **Total is about 2.5–4 dev-days.** SSE adds about 0.5–1 d.

**Limits.** You get no cross-channel orchestration, digests or batching ("5 new comments"), preference center, or delivery analytics unless you build them. Polling adds latency of up to the interval. Roughly 5,000 users polling every 60 s is about 80 req/s at worst, and far less in practice since only active tabs poll; that is fine for an indexed SQLite read. Retention and cleanup need a periodic `DELETE` of archived or old rows. SSE ties you to one process. If email or push channels are added later, a vendor's value rises sharply.

## Open questions / not verified

1. Is EU data residency a hard requirement? If so, Knock is out today [K2], MagicBell is unknown, and Courier needs Business.
2. Is near-instant delivery needed, or is 30–60 s polling acceptable for the "Student enrolled" and "new lesson" events?
3. Will email or digest channels follow? Postmark already exists, and orchestration across channels is where vendors earn their price.
4. Should "new lesson" Notifications go to every enrolled Student (fan-out), or only to those active recently? This drives vendor cost linearly.
5. Retention: how long are Notifications kept, and are archived ones ever shown?
6. Still unverified: MagicBell's EU status and mark-endpoint paths, Stream v3 regions, Novu Pro tiering above 30k, and whether HMAC works on self-hosted Novu.

## Sources

npm versions come from `https://registry.npmjs.org/<pkg>/latest` [npm], which covers `@knocklabs/react`, `@knocklabs/node`, `@novu/react`, `@novu/api`, `@magicbell/react`, `magicbell-js`, `@trycourier/courier-react`, `@trycourier/courier`, `@stream-io/feeds-react-sdk`, `@stream-io/node-sdk`, `getstream` and `react-activity-feed`.

- [K1] Knock pricing: https://knock.app/pricing
- [K2] Knock plans and usage (message definition, EU roadmap): https://docs.knock.app/manage-your-account/knock-plans
- [K3] Knock React overview: https://docs.knock.app/in-app-ui/react/overview
- [K4] Knock headless feed: https://docs.knock.app/in-app-ui/react/headless/feed
- [K5] Knock in-app API overview: https://docs.knock.app/in-app-ui/api-overview
- [K6] Knock socket behavior: https://docs.knock.app/in-app-ui/feeds/socket-behavior
- [K7] Knock security and authentication: https://docs.knock.app/in-app-ui/security-and-authentication
- [K8] Knock identifying recipients: https://docs.knock.app/managing-recipients/identifying-recipients
- [K9] Knock docs index (mark_as_read endpoints): https://docs.knock.app/llms.txt
- [K10] Knock privacy policy: https://knock.app/legal/privacy-policy
- [N1] Novu pricing: https://novu.co/pricing
- [N2] Novu security and data residency: https://docs.novu.co/platform/additional-resources/security.md
- [N3] Novu billing: https://docs.novu.co/platform/account/billing
- [N4] Novu self-hosting overview: https://docs.novu.co/community/self-hosting-novu/overview
- [N5] Novu React quickstart: https://docs.novu.co/platform/quickstart/react.md
- [N6] Novu repo licenses: https://github.com/novuhq/novu/blob/next/LICENSE-ENTERPRISE, `LICENSE-MIT`, `EE-PACKAGES-LICENSE`, and https://github.com/novuhq/novu/tree/next/enterprise/packages
- [N7] Novu `useNotifications`: https://docs.novu.co/platform/sdks/react/hooks/use-notifications.md
- [N8] Novu self-hosted vs Cloud: https://docs.novu.co/community/self-hosted-and-novu-cloud
- [N9] Novu Inbox HMAC security: https://docs.novu.co/.mintlify/skills/inbox-integration/references/security.md
- [N10] Novu headless mode: https://docs.novu.co/platform/inbox/headless-mode.md
- [N11] Novu TypeScript server SDK: https://docs.novu.co/platform/sdks/server/typescript.md
- [M1] MagicBell pricing: https://www.magicbell.com/pricing
- [M2] MagicBell React: https://www.magicbell.com/docs/libraries/magicbell-react
- [M3] MagicBell notification primitive: https://www.magicbell.com/docs/primitive/notification
- [M4] MagicBell in-app channel: https://www.magicbell.com/docs/channels/in_app
- [M5] MagicBell user JWT: https://www.magicbell.com/docs/api/authentication/user
- [M6] MagicBell API reference: https://www.magicbell.com/docs/api/reference
- [C1] Courier billing: https://www.courier.com/docs/workspaces/billing.md, and pricing at https://www.courier.com/pricing
- [C2] Courier datacenters: https://www.courier.com/docs/workspaces/datacenters.md
- [C3] Courier React SDK: https://www.courier.com/docs/sdk-libraries/courier-react-web.md
- [C4] Courier custom inbox: https://www.courier.com/docs/in-app/build-a-custom-inbox.md
- [C5] Courier authenticate users: https://www.courier.com/docs/in-app/authenticate-users.md
- [C6] Courier inbox behavior: https://www.courier.com/docs/in-app/how-the-inbox-behaves.md
- [C7] Courier Node SDK: https://www.courier.com/docs/sdk-libraries/node.md
- [S1] Stream Activity Feeds pricing: https://getstream.io/activity-feeds/pricing/
- [S2] Stream Feeds React docs: https://getstream.io/activity-feeds/docs/react/
- [S3] Stream notification feeds: https://getstream.io/activity-feeds/docs/react/notification-feeds/
- [S4] Stream v2 performance and regions: https://getstream.io/activity-feeds/docs/javascript/v2/performance/
- [S5] Stream Feeds Node docs: https://getstream.io/activity-feeds/docs/node/
- [RR1] React Router `useRevalidator`: https://reactrouter.com/api/hooks/useRevalidator
- [RR2] React Router resource routes: https://reactrouter.com/how-to/resource-routes
