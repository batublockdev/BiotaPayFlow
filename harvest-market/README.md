# Harvest — agricultural investment marketplace

A runnable MVP using **Next.js + React + TypeScript** on the frontend and a **separate Node.js + Express + TypeScript API**. SQLite persists projects, sessions, accepted agreements, orders, payments, and a balanced simulation journal. Node 24 or newer is required (uses `node:sqlite`).

## Start locally

```bash
npm ci
npm run dev
```

Open http://localhost:3000. The API listens on http://127.0.0.1:4000. Next.js proxies `/api/*` to the API. Do not open the API port to the public internet. Both processes must remain running.

The database is created and seeded on first API startup at `apps/api/harvest.sqlite`. Stop the API and remove that file and its SQLite sidecars to reset the demo. Do not reset a database containing records you need.

## Try the complete workflow

1. Sign in as **Investor**. Open the apple project, accept its displayed terms, and simulate its full investment.
2. Sign out and sign in as **Farmer**. Open **My harvests**, post a production update, and mark the harvest ready for sale.
3. Sign out and sign in as **Buyer**. Open **Marketplace** and buy some apples. Buy the remaining quantity to complete the harvest.
4. Sign in as **Investor** or **Farmer** and inspect **Activity**. The final purchase automatically creates principal-plus-profit payment for the investor and remaining-profit payment for the farmer.
5. Farmers can create additional USD or EUR projects through **New project**.

Demo accounts: `investor@harvest.demo`, `farmer@harvest.demo`, `buyer@harvest.demo`. All use `HarvestDemo123!`. The role chooser logs into these seeded accounts through the real session endpoint. These are shared demonstration identities, not production onboarding. Do not expose this demo as a live financial service.

## Agreed business model

- One investor per farmer. Once a farmer has an investor, another investor cannot fund that farmer's other projects. The same investor may fund additional projects.
- One complete funding contribution per project; no partial contributions or crowdfunding.
- The farmer publishes fixed terms and the investor explicitly accepts them. Acceptance snapshots principal, percentage, quantity, currency, and timestamp. No post-acceptance editing is exposed.
- Full funding immediately makes funds available to the farmer in the simulation and moves the project to `GROWING`.
- The farmer marks a funded harvest ready, moving it to `SELLING`.
- Fixed unit prices and exact planned quantities are used. Production updates do not modify inventory.
- Distribution happens only after all planned units have been purchased with confirmed simulated payments. There is no scheduled maturity.
- USD and EUR are supported separately. No foreign-exchange flow is implemented. Currency is not a country restriction.

### Calculation

All stored monetary amounts are integer cents. Percentage is integer basis points (30% = 3000). Intermediate royalty multiplication uses BigInt. Any fractional cent stays with the farmer.

```
profit = total confirmed sales - invested principal
investor royalty = floor(profit * shareBasisPoints / 10000)
investor payment = principal + investor royalty
farmer payment = profit - investor royalty
```

Example in any single currency: principal 10,000; sales 20,000; investor share 30%. Profit is 10,000, investor receives 13,000, farmer receives 7,000.

**MVP assumption:** funded principal represents the entire production cost basis. This is not full accounting profit if there are other costs, taxes, refunds, fees, or exchange differences. Those inputs are deliberately not modeled. Project creation rejects planned revenue below principal; unexpected negative-profit calculations are blocked, not assigned an invented loss policy.

## Payment boundary — read before integration

**No real money moves. Open Payments is not connected.** Every payment record has provider `simulation` and status `SIMULATED_COMPLETED`. Funding, collection, and distributions are synchronous simulator operations. They are not evidence of provider confirmation or external settlement. `PAYMENT_MODE` other than `simulation` prevents API startup.

Open Payments is a standard for authenticated payment instructions. Provider quotes can include applicable charges; the standard does not determine your marketplace's fee policy or absorb refunds and losses. There is no universal “Open Payments platform fee.” This demo has zero modeled platform/provider fees, which is an explicit simulation assumption, not a pricing claim.

Official documentation consulted:
- https://openpayments.dev/concepts/resources/
- https://openpayments.dev/introduction/op-concepts/
- https://openpayments.dev/apis/resource-server/operations/create-outgoing-payment/

`apps/api/src/payments.ts` documents the future provider interface and includes a deliberately failing live adapter. It is **not** an implemented integration. The current simulator is recorded inside the transactional application service.

Before live integration, choose an account servicing entity and configure application keys, wallet addresses, authorization grants, callbacks and polling, quote currency/scale checks, and grant expiry/revocation. Design the funds flow: buyers' funds cannot be assumed to sit in application custody, and payouts from the farmer's wallet require appropriate authorization. Introduce durable payment intents, an outbox/worker, provider confirmation, reconciliation, retries, and recoverable partial distributions. Never place external provider calls inside the current SQLite transaction or treat a browser redirect as confirmation.

## Architecture

```
apps/web/                 Next.js App Router frontend
  app/page.tsx            Discovery, marketplace, role dashboards and dialogs
  app/globals.css         Responsive design system
  next.config.ts          Same-origin API proxy
apps/api/                 Separate Node.js service
  src/app.ts              HTTP routes, authorization, transactional workflows
  src/db.ts               SQLite schema and demonstration seed data
  src/domain.ts           Exact profit allocation
  src/payments.ts         Future provider contract; live mode intentionally unavailable
  src/server.ts           Server entry point
  test/workflow.test.ts   Financial and API workflow tests
```

A compact modular monolith: API owns persistent data and business rules; frontend never calculates authoritative payouts. No microservices are required. SQL tables are separated by domain, but this is an initial vertical slice rather than a full twelve-module production implementation.

Project states: `FUNDING → GROWING → SELLING → SOLD_OUT → DISTRIBUTED`. In the simulator, the final three changes and all payout entries commit atomically; `SOLD_OUT` is transitional. A live asynchronous provider must keep sale completion separate from payout completion.

Journal lines are signed balance movements: recipient increases and source decreases, balanced per payment and currency. This is a simulation transfer journal, not a complete statutory general ledger. Proceeds clear to zero at distribution.

## API overview

| Method | Route | Access |
|---|---|---|
| GET | `/api/health` | Public; includes simulation mode |
| GET | `/api/projects` | Public catalog |
| POST | `/api/login` | Email and password; HttpOnly session cookie |
| GET | `/api/me` | Signed-in participant |
| POST | `/api/logout` | Signed-in participant |
| GET | `/api/dashboard` | Only participant-owned investments/orders/payments |
| POST | `/api/projects` | Farmer |
| GET | `/api/projects/:id/updates` | Signed-in participant |
| POST | `/api/projects/:id/fund` | Investor; `{ "acceptTerms": true }` |
| POST | `/api/projects/:id/harvest` | Owning farmer |
| POST | `/api/projects/:id/update` | Owning farmer; `{ "body": "..." }` |
| POST | `/api/projects/:id/buy` | Buyer; `{ "quantity": 100 }` |

All project action routes require a unique `Idempotency-Key` (8–100 characters). Reuse the same key and body to safely retry an uncertain action. Reusing it for different input fails. Project creation is not yet idempotent. Client buttons disable while an operation is running; the demo UI does not persist keys across reloads, so recovery after ambiguous connection failure requires a status check before retrying.

SQLite `BEGIN IMMEDIATE` transactions protect stock, funding, journal entries, and request replay records together. Sessions use random tokens, 24-hour expiry, HttpOnly/SameSite cookies, and scrypt password hashes. Backend role and ownership checks are enforced. Mutation requests with an unexpected Origin are rejected. Login has a per-process attempt limit.

## Configuration

| Variable | Service | Default |
|---|---|---|
| `PORT` | API | `4000` |
| `DB_PATH` | API | `harvest.sqlite` relative to API working directory |
| `PAYMENT_MODE` | API | `simulation`; other values rejected |
| `WEB_ORIGIN` | API | `http://localhost:3000` |
| `API_URL` | Next.js | `http://127.0.0.1:4000`; used in build-time rewrites |
| `NODE_ENV` | API | Set `production` only behind HTTPS; enables Secure cookies |

Export API variables in the shell before starting; the API does not load `.env` files automatically. Next.js supports its standard `.env.local` mechanism. Do not commit credentials. The UI uses optional Google Fonts with local fallbacks and CSS/emoji illustrations; no image assets or image services are needed.

## Verification

```bash
npm test
npm run typecheck
npm run build
```

Tests cover profit allocation and cent remainders; invalid-loss calculations; authentication and role boundaries; acceptance requirements; full funding; duplicate funding; harvest transitions; duplicate and mismatched purchase retries; overselling; competing purchases; no early royalties; final distribution; balanced journals; zero residual proceeds; dashboard privacy; and logout.

Three automated test scenarios pass; TypeScript checks and the Next.js production build pass. No browser visual/interaction automation was available in this environment.

To run built services locally, in separate terminals:

```bash
npm run start -w apps/api
npm run start -w apps/web
```

## Deliberately deferred

Real Open Payments integration, self-service registration, email/password recovery, multi-role accounts, admin review, compliance onboarding, cancellation/refund workflows, crop failure/loss policies, delivery, taxes, invoices, provider fees, currency conversion, milestone disbursements, notifications, production reconciliation and deployment. Refunds and negative-profit scenarios must remain blocked until their rules are defined.

Before production, replace shared demo identities; add durable migrations, backup/recovery, monitoring, robust distributed rate limiting and authorization review; choose a production database strategy; and complete the provider and funds-flow work above. Source is supplied for the requested Next.js + independent Node.js architecture. It has not been deployed to a hosting provider.
