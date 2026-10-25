# Booking reliability and boundaries

## Allocation and retries

`server/app.ts` takes `BEGIN IMMEDIATE` before looking up a user-scoped idempotency key. It reads price/capacity from SQLite, validates the slot and stores both the booking and its original response in that transaction. A failed result write rolls the booking back. Equal-key/equal-payload replay returns that original response; a new payload with the same key returns 409, including after restart. A replay is an operation receipt, not the booking’s current status: fetch the booking list for later expiration/cancellation.

Insert/update SQL triggers deny intersecting pending/confirmed intervals using `old.start < new.end && old.end > new.start`. Exact adjacency is allowed. Separate HTTP servers with independent SQLite connections race against one file in `tests/concurrency.test.ts`. A saved session and receipt also survive reopen in `tests/expiry-restart.test.ts`. Under a held second-connection write lock, API mutation fails safely with 503; after release the same key remains usable.

## Expiration

`server/booking-expiry.ts` shares one indexed conditional UPDATE between the API and standalone idle scheduler. Pending rows whose UTC expiry timestamp is due become expired. Confirmed/cancelled rows are untouched. Startup runs cleanup and the timer repeats every 30 seconds; repeated passes are harmless. Request-time cleanup remains authoritative before allocation/confirmation, so idle timer delays do not grant an expired hold. Stop clears the timer, and a temporary DB error is logged as a fixed failure event without crashing the loop. External SQL writers must call the same pass before using the active-slot triggers.

## Time and amounts

The existing business contract remains one fixed Moscow UTC+03:00 zone: a calendar booking date and local HH:mm interval, 08:00–22:00, minimum one hour. It is not a configurable IANA time-zone engine and has no DST transitions. Hold expiry/session expiry use UTC timestamps/epoch values. Amount is the stored room’s whole-rouble hourly rate times duration, rounded on the server. Clients cannot supply totalPrice; room catalogue rates are operator-controlled. There are no payments or refunds.

## Identity and deployment

Standalone published guest/owner credentials are deliberately loopback-only, outside production; the entry point validates this before opening the database. Per-request peer/Host checks reject remote/DNS-rebinding access. Cookie sessions are random, hashed in SQLite, HttpOnly and SameSite Strict; cross-site/origin writes are denied. This does not turn demo identities into a customer account system. Native Sites identity is separate and does not trust X-Demo-Actor. No native deployment/migration is performed by these source changes.

## Repeatable checks

`pnpm test`, `pnpm test:contract`, `pnpm test:upgrade`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`, `pnpm test:e2e`. Tests use in-memory or temporary databases and never the operator’s data file. CI runs browser checks on Linux; Windows extension-based browser zoom may be unavailable in restricted runtimes and is not substituted by CSS zoom.
