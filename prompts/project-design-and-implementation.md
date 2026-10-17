Act as a senior software architect and full-stack engineer. Help me design and develop a global agricultural marketplace that connects investors, local farmers, and product buyers.

Start by reviewing the requirements, identifying important gaps, and proposing an implementation plan. Do not begin coding until I have reviewed the proposed architecture and business assumptions.

1. Product vision

The platform supports the complete lifecycle of agricultural funding and commerce:

* Farmers publish agricultural projects that need investment.
* Investors discover projects and provide funding.
* Farmers use that funding to produce agricultural goods.
* Buyers purchase the resulting products through the marketplace.
* The application tracks transactions and calculates and distributes investor returns or royalties according to the agreed terms.
* The platform integrates with Open Payments for payment operations.

The application must clearly distinguish money committed, money received, money owed, and money paid.

2. User roles

Support these roles:

Investor

* Browse agricultural projects and review funding requirements, timelines, risks, and proposed investment terms.
* Invest in projects.
* Track investment status and production progress.
* View accrued returns, completed payouts, and transaction history.

Farmer

* Create a profile and register farms.
* Publish projects with funding targets, budgets, timelines, and expected production.
* Track funding received and disbursements.
* Publish production updates.
* Manage products, inventory, orders, and earnings.

Buyer

* Browse products and farmer profiles.
* Place orders and complete payments.
* Track fulfillment and delivery.
* Request cancellations, returns, or refunds where applicable.

Administrator

* Review participants, projects, and product listings.
* Manage operational disputes and exceptions.
* Inspect transactions, reconciliation issues, and payout failures.
* Configure platform fees and manage permissions.
* Review audit history.

Allow one account to hold multiple roles. Enforce authorization on the backend, including ownership checks.

3. Functional modules

Organize the application into clearly separated modules:

1. Identity and participants: authentication, profiles, organizations, roles, permissions, and onboarding.
2. Farms and projects: farms, agricultural projects, funding needs, budgets, production cycles, and project status.
3. Investments and funding: commitments, confirmed contributions, funding progress, allocations, and investor portfolios.
4. Agreements: versioned investment terms, acceptance records, return rules, and eligibility periods.
5. Production and inventory: milestones, harvest batches, stock, and traceability to the funded project.
6. Catalog: product listings, descriptions, prices, currencies, and availability.
7. Orders and fulfillment: checkout, inventory reservations, delivery tracking, cancellations, returns, and disputes.
8. Payments: Open Payments integration, payment authorization, collections, disbursements, status tracking, and failure handling.
9. Financial ledger and reconciliation: auditable financial records, balances, obligations, fees, refunds, and reconciliation with external payment activity.
10. Royalties and revenue allocation: calculation of investor, farmer, and platform entitlements; payout scheduling; and adjustments.
11. Administration and operational review: approvals, restrictions, exception handling, and audit trails.
12. Reporting and notifications: dashboards, statements, transaction history, and relevant updates.

Keep agreement rules, royalty calculations, financial recording, and payment execution separate.

4. Core workflows

Design the following end-to-end workflows:

Project funding

1. Farmer submits a project.
2. The project is reviewed if approval is required.
3. Investor reviews and accepts the applicable agreement.
4. Investor initiates a contribution.
5. Confirmed payment updates the investment and financial ledger.
6. Funds are disbursed according to the project’s release conditions.

Production and sales

1. Farmer records production progress and harvest batches.
2. Products are linked to the appropriate project and inventory.
3. Buyer places an order.
4. Inventory is reserved and payment is initiated.
5. Confirmed payment advances the order.
6. Farmer fulfills the order and delivery is recorded.

Revenue distribution

1. A defined business event makes sale proceeds eligible for distribution.
2. The application identifies the applicable agreement and beneficiaries.
3. It calculates farmer proceeds, investor returns, and platform fees.
4. It records amounts owed.
5. It initiates eligible payouts.
6. It confirms outcomes and exposes failures for retry or review.

Include failure paths for declined or abandoned payments, underfunded projects, production failures, insufficient inventory, cancellations, refunds, and partially completed payouts.

5. Financial rules and Open Payments

Verify the exact Open Payments implementation and its official documentation before designing the integration. Do not invent API endpoints or assume the provider supports escrow, automatic split payments, refunds, recurring authorization, or every currency and country.

Use a payment adapter so domain logic does not depend directly on provider-specific objects.

Financial requirements:

* Represent money using precise decimal or integer minor-unit arithmetic with explicit currency and scale. Never use floating-point arithmetic for money.
* Keep balances separated by currency.
* Record conversion amounts, rates, and fees when currency conversion occurs.
* Use an auditable double-entry ledger with a documented posting model.
* Correct completed financial records through reversals or adjustments.
* Make financial operations idempotent and safe against duplicate requests and repeated provider notifications.
* Distinguish pending, confirmed, failed, and other relevant payment states.
* Do not treat a successful browser redirect as proof of payment.
* Reconcile external payment activity with internal records.
* Preserve the agreement version and calculation inputs behind every royalty allocation.
* Define rounding and remainder allocation so distributed amounts balance exactly.
* Handle refunds before and after beneficiary payouts.
* Never mark a complete distribution as paid when only some payouts succeeded.

Do not assume the application holds customer funds. Identify the proposed funds flow and custody model before implementing it.

6. Business decisions to resolve

Explain the implementation impact of these questions and request answers before implementing the affected behavior:

* Are investments loans, revenue-sharing agreements, profit-sharing agreements, ownership interests, or another model?
* What exactly does “royalty” mean in this marketplace?
* Is investor principal repaid separately?
* Are returns capped, time-limited, or tied to a particular harvest?
* Are returns calculated from gross sales, net revenue, or profit?
* How are returns divided among multiple investors?
* What happens if the funding target is not reached?
* When can farmers access funds?
* What happens when production fails or yields are lower than expected?
* What event makes revenue eligible for distribution?
* Who bears payment fees, exchange costs, refunds, and losses?
* What platform fees apply?
* Which countries and currencies are included in the first release?
* Who handles delivery, taxes, and invoicing?

Do not silently invent these rules. For demonstrations, label any proposed defaults as assumptions and use simulated funds.

7. Architecture and implementation approach

Prefer a modular monolith for the initial release, with explicit module boundaries and a relational database.

Propose a suitable technology stack and explain the tradeoffs. Ask whether there are existing repository or stack constraints before selecting one.

Include:

* Backend APIs and server-side validation.
* A responsive frontend with role-specific navigation and dashboards.
* Database migrations and clear ownership of data by module.
* Background processing for reconciliation, notifications, and payouts.
* Reliable event delivery where needed, such as a transactional outbox.
* Concurrency controls for inventory, funding limits, and financial operations.
* Secure secret management and protection of sensitive data.
* Structured logs and correlation identifiers.
* Local development configuration and synthetic seed data.

Keep the first release manageable. Explicitly separate MVP requirements from later enhancements.

8. User experience

Provide clear screens for:

* Project discovery and project details.
* Investment review and confirmation.
* Investor portfolio and payout history.
* Farmer project management and production updates.
* Product catalog and product details.
* Cart, checkout, and order tracking.
* Farmer sales and earnings.
* Administrative review and financial exceptions.

Show pending, failed, and completed states accurately. Avoid presenting projected returns as guaranteed earnings.

9. Testing and acceptance criteria

Prioritize tests for financial correctness, authorization, and complete workflows.

Verify that:

* Duplicate payment processing cannot create duplicate financial entries or payouts.
* Users cannot access another participant’s private records.
* Concurrent orders cannot oversell inventory.
* Funding limits behave correctly under concurrent contributions.
* Royalty allocations match accepted agreement versions.
* Allocations balance after rounding.
* Failed payouts can be retried without paying twice.
* Refunds and reversals produce correct balances.
* Partial payout failures remain visible and recoverable.
* External payment discrepancies can be detected through reconciliation.

Use the provider’s sandbox where available. Clearly distinguish simulated payment behavior from verified integration behavior.

10. Expected first response

Before writing code, provide:

1. Your understanding of the product.
2. The highest-impact clarification questions.
3. A proposed MVP scope.
4. A module breakdown and architecture diagram.
5. The main entities and their relationships.
6. Proposed investment, order, and payment state transitions.
7. A proposed technology stack with tradeoffs.
8. A phased implementation plan.
9. Explicit assumptions, dependencies, and unresolved risks.

After I approve the plan, implement the application incrementally in working end-to-end slices. For each slice, explain what works, what was tested, and what remains incomplete.