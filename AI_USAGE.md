# AI Usage Disclosure

## Tools Used

- **GPTAstra:** Used through the paid Plus plan (US$20).
- **Gemini:** Used during development.
- **Claude:** Used during development.

## Where and How We Used AI

AI assistance was used throughout the whole project, including implementation and debugging. The tools listed above supported this work; individual contributions were not attributed to a particular tool in this disclosure.

### 1. Buyer, Farmer, and Investor Core Logic

AI assisted with implementing the core workflows for buyers, farmers, and investors across the backend and frontend.

Relevant files include:

- `harvest-market/apps/api/src/domain.ts`
- `harvest-market/apps/api/src/app.ts`
- `harvest-market/apps/web/app/page.tsx`
- `harvest-market/apps/web/app/BuyerHarvestPipeline.tsx`
- `harvest-market/apps/web/app/ReadyForSale.tsx`
- `harvest-market/apps/web/app/ProjectPhases.tsx`
- `harvest-market/apps/web/app/GrowerPhaseFields.tsx`

### 2. Open Payments Integration

AI assisted with implementing the Open Payments integration and debugging the payment flow.

Relevant files include:

- `harvest-market/apps/api/src/openPayments.ts`
- `harvest-market/apps/api/src/openPaymentsProvider.ts`
- `harvest-market/apps/api/src/payments.ts`
- `harvest-market/apps/web/app/payment-callback/page.tsx`

### 3. Debugging Throughout the Project

AI assisted with investigating errors and developing fixes across the application, including the buyer, farmer, investor, and payment workflows.

### 4. Documentation

Codex assisted with drafting this `AI_USAGE.md` file using the team's description of its AI usage and the repository's file structure.
