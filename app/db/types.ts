import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "./schema";

// The database types every `*.server.ts` module takes as its first argument.
// Type-only, so importing them never pulls the connection into a bundle.

/** The app's database (or an in-memory one in tests). */
export type Db = BetterSQLite3Database<typeof schema>;

/** A transaction opened with `db.transaction(...)`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Anything a query can run against: the database or a transaction. */
export type Queryable = Db | Tx;
