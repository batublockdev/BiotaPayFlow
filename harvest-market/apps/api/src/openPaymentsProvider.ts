/**
 * Open Payments provider — real Interledger integration.
 *
 * Two flows:
 * 1. Funding: Investor → Grower (single payment)
 * 2. Purchase: Buyer → Grower + Investor + Platform (split payment)
 */

import { createAuthenticatedClient, isPendingGrant, isFinalizedGrantWithAccessToken, type AuthenticatedClient, type WalletAddress } from '@interledger/open-payments';
import { getOpenPaymentsConfig, type OpenPaymentsConfig } from './openPayments.js';
import { randomUUID } from 'node:crypto';

// ─── Funding state (investor → grower) ───────────────────────────────────────

export type FundPaymentState = {
  projectId: string;
  investorId: string;
  growerId: string;
  amount: number;
  currency: 'USD' | 'EUR' | 'COP';
  incomingPaymentId: string;
  quoteId: string;
  outgoingGrantUri: string;
  outgoingGrantAccessToken: string;
  interactRef: string | null;
  nonce: string;
  status: 'PENDING_CONSENT' | 'COMPLETED' | 'FAILED';
  createdAt: number;
};

const pendingPayments = new Map<string, FundPaymentState>();

export function storePaymentState(id: string, state: FundPaymentState): void { pendingPayments.set(id, state); }
export function getPaymentState(id: string): FundPaymentState | undefined { return pendingPayments.get(id); }
export function updatePaymentState(id: string, patch: Partial<FundPaymentState>): void {
  const c = pendingPayments.get(id); if (c) pendingPayments.set(id, { ...c, ...patch });
}

// ─── Split purchase state (buyer → grower + investor + platform) ──────────────

export type SplitPaymentState = {
  paymentId: string;
  projectId: string;
  buyerId: string;
  investorId: string | null;
  growerId: string;
  investorAmount: number;
  growerAmount: number;
  platformAmount: number;
  totalDebitAmount: number;
  investorIncomingId: string | null;
  growerIncomingId: string;
  platformIncomingId: string;
  investorQuoteId: string | null;
  growerQuoteId: string;
  platformQuoteId: string;
  outgoingGrantUri: string;
  outgoingGrantAccessToken: string;
  interactRef: string | null;
  nonce: string;
  status: 'PENDING_CONSENT' | 'COMPLETED' | 'FAILED';
  createdAt: number;
};

const pendingSplits = new Map<string, SplitPaymentState>();

export function storeSplitState(id: string, state: SplitPaymentState): void { pendingSplits.set(id, state); }
export function getSplitState(id: string): SplitPaymentState | undefined { return pendingSplits.get(id); }
export function updateSplitState(id: string, patch: Partial<SplitPaymentState>): void {
  const c = pendingSplits.get(id); if (c) pendingSplits.set(id, { ...c, ...patch });
}

// ─── Client ──────────────────────────────────────────────────────────────────

let _client: AuthenticatedClient | null = null;

async function getClient(config?: OpenPaymentsConfig): Promise<AuthenticatedClient> {
  if (_client) return _client;
  const cfg = config ?? getOpenPaymentsConfig();
  _client = await createAuthenticatedClient({
    walletAddressUrl: cfg.clientWalletAddress,
    keyId: cfg.keyId,
    privateKey: cfg.privateKeyPath,
  });
  return _client;
}

// ─── Status check ────────────────────────────────────────────────────────────

export function checkPaymentStatus(paymentId: string): { status: string; projectId: string } | null {
  const fund = getPaymentState(paymentId);
  if (fund) return { status: fund.status, projectId: fund.projectId };
  const split = getSplitState(paymentId);
  if (split) return { status: split.status, projectId: split.projectId };
  return null;
}

// ─── Funding flow (investor → grower) ────────────────────────────────────────

export type InitiateFundingResult = {
  paymentId: string;
  redirectUrl: string;
  interactFinish: string;
};

export async function initiateFunding(params: {
  projectId: string;
  investorId: string;
  growerId: string;
  amount: number;
  currency: 'USD' | 'EUR' | 'COP';
  callbackUrl: string;
}): Promise<InitiateFundingResult> {
  const config = getOpenPaymentsConfig();
  const client = await getClient(config);

  const investorWallet = await client.walletAddress.get({ url: config.wallets.investor! }) as WalletAddress;
  const growerWallet = await client.walletAddress.get({ url: config.wallets.grower! }) as WalletAddress;

  // IncomingPayment on grower's wallet (uses grower's asset code/scale)
  const incomingGrant = await client.grant.request(
    { url: growerWallet.authServer },
    { access_token: { access: [{ type: 'incoming-payment', actions: ['read', 'create'] }] } }
  );
  const incomingToken = 'access_token' in incomingGrant ? incomingGrant.access_token!.value : '';

  const incomingPayment = await client.incomingPayment.create(
    { url: growerWallet.resourceServer, accessToken: incomingToken },
    {
      walletAddress: growerWallet.id,
      incomingAmount: { assetCode: growerWallet.assetCode, assetScale: growerWallet.assetScale, value: String(params.amount) },
      metadata: { description: `Investment funding for project ${params.projectId}`, externalRef: `biotapayflow-fund-${params.projectId}` },
    }
  );

  // Quote on investor's wallet
  const quoteGrant = await client.grant.request(
    { url: investorWallet.authServer },
    { access_token: { access: [{ type: 'quote', actions: ['create', 'read'] }] } }
  );
  const quoteToken = 'access_token' in quoteGrant ? quoteGrant.access_token!.value : '';

  const quote = await client.quote.create(
    { url: investorWallet.resourceServer, accessToken: quoteToken },
    { walletAddress: investorWallet.id, receiver: incomingPayment.id, method: 'ilp' as never }
  );

  // OutgoingPayment grant with interact (investor consent)
  const nonce = randomUUID();
  const outgoingGrant = await client.grant.request(
    { url: investorWallet.authServer },
    {
      access_token: {
        access: [{ type: 'outgoing-payment', actions: ['read', 'create', 'list'], identifier: investorWallet.id, limits: { debitAmount: quote.debitAmount } }],
      },
      interact: { start: ['redirect'], finish: { method: 'redirect', uri: params.callbackUrl, nonce } },
    }
  );

  if (!isPendingGrant(outgoingGrant)) throw new Error('Expected pending grant with interact redirect');

  const paymentId = randomUUID();
  storePaymentState(paymentId, {
    projectId: params.projectId, investorId: params.investorId, growerId: params.growerId,
    amount: params.amount, currency: params.currency,
    incomingPaymentId: incomingPayment.id, quoteId: quote.id,
    outgoingGrantUri: outgoingGrant.continue.uri, outgoingGrantAccessToken: outgoingGrant.continue.access_token.value,
    interactRef: null, nonce, status: 'PENDING_CONSENT', createdAt: Date.now(),
  });

  return { paymentId, redirectUrl: outgoingGrant.interact.redirect, interactFinish: outgoingGrant.interact.finish };
}

export async function completeFunding(paymentId: string, interactRef: string): Promise<{
  outgoingPaymentId: string; receiver: string; sentAmount: string; debitAmount: string;
}> {
  const state = getPaymentState(paymentId);
  if (!state) throw new Error('Payment state not found');
  if (state.status === 'COMPLETED') throw new Error('Payment already completed');

  const client = await getClient();
  const config = getOpenPaymentsConfig();
  const investorWallet = await client.walletAddress.get({ url: config.wallets.investor! }) as WalletAddress;

  const continueResult = await client.grant.continue(
    { url: state.outgoingGrantUri, accessToken: state.outgoingGrantAccessToken },
    { interact_ref: interactRef }
  );
  if (!isFinalizedGrantWithAccessToken(continueResult)) throw new Error('Grant not finalized — investor may have denied consent');

  const outgoingPayment = await client.outgoingPayment.create(
    { url: investorWallet.resourceServer, accessToken: continueResult.access_token.value },
    {
      walletAddress: investorWallet.id, quoteId: state.quoteId,
      metadata: { description: `Investment funding for project ${state.projectId}`, externalRef: `biotapayflow-fund-${state.projectId}` },
    }
  );

  updatePaymentState(paymentId, { status: 'COMPLETED', interactRef });
  return { outgoingPaymentId: outgoingPayment.id, receiver: String(outgoingPayment.receiver), sentAmount: outgoingPayment.sentAmount.value, debitAmount: outgoingPayment.debitAmount.value };
}

// ─── Split purchase flow (buyer → grower + investor + platform) ──────────────

export type InitiatePurchaseResult = {
  paymentId: string;
  redirectUrl: string;
  interactFinish: string;
};

async function createIncomingPayment(client: AuthenticatedClient, wallet: WalletAddress, amount: number, description: string, ref: string) {
  const grant = await client.grant.request(
    { url: wallet.authServer },
    { access_token: { access: [{ type: 'incoming-payment', actions: ['create', 'read'] }] } }
  );
  const token = 'access_token' in grant ? grant.access_token!.value : '';
  return client.incomingPayment.create(
    { url: wallet.resourceServer, accessToken: token },
    {
      walletAddress: wallet.id,
      incomingAmount: { assetCode: wallet.assetCode, assetScale: wallet.assetScale, value: String(amount) },
      metadata: { description, externalRef: ref },
    }
  );
}

export async function initiatePurchase(params: {
  projectId: string;
  buyerId: string;
  investorId: string | null;
  growerId: string;
  investorAmount: number;
  growerAmount: number;
  platformAmount: number;
  callbackUrl: string;
}): Promise<InitiatePurchaseResult> {
  const config = getOpenPaymentsConfig();
  const client = await getClient(config);

  // 1. Get all wallet addresses
  const buyerWallet = await client.walletAddress.get({ url: config.wallets.buyer! }) as WalletAddress;
  const growerWallet = await client.walletAddress.get({ url: config.wallets.grower! }) as WalletAddress;
  const platformWalletUrl = config.clientWalletAddress;
  const platformWallet = await client.walletAddress.get({ url: platformWalletUrl }) as WalletAddress;

  let investorWallet: WalletAddress | null = null;
  if (params.investorId && params.investorAmount > 0) {
    investorWallet = await client.walletAddress.get({ url: config.wallets.investor! }) as WalletAddress;
  }

  const ref = `biotapayflow-buy-${params.projectId}`;

  // 2. Create IncomingPayments on each recipient's wallet
  const growerIncoming = await createIncomingPayment(client, growerWallet, params.growerAmount, `Sale proceeds — ${params.projectId}`, ref + '-grower');
  const platformIncoming = await createIncomingPayment(client, platformWallet, params.platformAmount, `Platform commission — ${params.projectId}`, ref + '-platform');

  let investorIncoming: { id: string } | null = null;
  if (investorWallet && params.investorAmount > 0) {
    investorIncoming = await createIncomingPayment(client, investorWallet, params.investorAmount, `Investor return — ${params.projectId}`, ref + '-investor');
  }

  // 3. Create Quotes on buyer's wallet — one per incoming payment
  const quoteGrant = await client.grant.request(
    { url: buyerWallet.authServer },
    { access_token: { access: [{ type: 'quote', actions: ['create', 'read'] }] } }
  );
  const quoteToken = 'access_token' in quoteGrant ? quoteGrant.access_token!.value : '';

  async function createQuote(receiverId: string) {
    return client.quote.create(
      { url: buyerWallet.resourceServer, accessToken: quoteToken },
      { walletAddress: buyerWallet.id, receiver: receiverId, method: 'ilp' as never }
    );
  }

  const growerQuote = await createQuote(growerIncoming.id);
  const platformQuote = await createQuote(platformIncoming.id);
  let investorQuote: { id: string } | null = null;
  if (investorIncoming) {
    const iq = await createQuote(investorIncoming.id);
    investorQuote = { id: iq.id };
  }

  // 4. Combine debit amounts
  const totalDebit = parseInt(growerQuote.debitAmount.value, 10) + parseInt(platformQuote.debitAmount.value, 10) + (investorQuote ? 0 : 0);
  // Note: investor debit will be added if present — we need to re-fetch it
  let investorDebit = 0;
  if (investorIncoming) {
    const iq = await client.quote.get({ url: investorQuote!.id, accessToken: quoteToken });
    investorDebit = parseInt(iq.debitAmount.value, 10);
  }
  const combinedDebit = parseInt(growerQuote.debitAmount.value, 10) + parseInt(platformQuote.debitAmount.value, 10) + investorDebit;

  // 5. Create single OutgoingPayment grant with combined debitAmount
  const nonce = randomUUID();
  const outgoingGrant = await client.grant.request(
    { url: buyerWallet.authServer },
    {
      access_token: {
        access: [{
          type: 'outgoing-payment',
          actions: ['read', 'create', 'list'],
          identifier: buyerWallet.id,
          limits: {
            debitAmount: { assetCode: buyerWallet.assetCode, assetScale: buyerWallet.assetScale, value: String(combinedDebit) },
          },
        }],
      },
      interact: { start: ['redirect'], finish: { method: 'redirect', uri: params.callbackUrl, nonce } },
    }
  );

  if (!isPendingGrant(outgoingGrant)) throw new Error('Expected pending grant for buyer consent');

  const paymentId = randomUUID();
  storeSplitState(paymentId, {
    paymentId, projectId: params.projectId, buyerId: params.buyerId, investorId: params.investorId, growerId: params.growerId,
    investorAmount: params.investorAmount, growerAmount: params.growerAmount, platformAmount: params.platformAmount,
    totalDebitAmount: combinedDebit,
    investorIncomingId: investorIncoming?.id || null,
    growerIncomingId: growerIncoming.id,
    platformIncomingId: platformIncoming.id,
    investorQuoteId: investorQuote?.id || null,
    growerQuoteId: growerQuote.id,
    platformQuoteId: platformQuote.id,
    outgoingGrantUri: outgoingGrant.continue.uri,
    outgoingGrantAccessToken: outgoingGrant.continue.access_token.value,
    interactRef: null, nonce, status: 'PENDING_CONSENT', createdAt: Date.now(),
  });

  return { paymentId, redirectUrl: outgoingGrant.interact.redirect, interactFinish: outgoingGrant.interact.finish };
}

export async function completePurchase(paymentId: string, interactRef: string): Promise<{
  payments: { recipient: string; outgoingPaymentId: string; sentAmount: string }[];
}> {
  const state = getSplitState(paymentId);
  if (!state) throw new Error('Split payment state not found');
  if (state.status === 'COMPLETED') throw new Error('Split payment already completed');

  const client = await getClient();
  const config = getOpenPaymentsConfig();
  const buyerWallet = await client.walletAddress.get({ url: config.wallets.buyer! }) as WalletAddress;

  const continueResult = await client.grant.continue(
    { url: state.outgoingGrantUri, accessToken: state.outgoingGrantAccessToken },
    { interact_ref: interactRef }
  );
  if (!isFinalizedGrantWithAccessToken(continueResult)) throw new Error('Grant not finalized — buyer may have denied consent');

  const accessToken = continueResult.access_token.value;
  const results: { recipient: string; outgoingPaymentId: string; sentAmount: string }[] = [];

  async function createOutgoing(quoteId: string, recipient: string) {
    if (!state) throw new Error('Split payment state lost');
    const op = await client.outgoingPayment.create(
      { url: buyerWallet.resourceServer, accessToken },
      {
        walletAddress: buyerWallet.id, quoteId,
        metadata: { description: `Purchase split — ${state.projectId} — ${recipient}`, externalRef: `biotapayflow-buy-${state.projectId}-${recipient}` },
      }
    );
    results.push({ recipient, outgoingPaymentId: op.id, sentAmount: op.sentAmount.value });
  }

  if (!state) throw new Error('Split payment state lost');
  await createOutgoing(state.growerQuoteId, 'grower');
  await createOutgoing(state.platformQuoteId, 'platform');
  if (state.investorQuoteId) {
    await createOutgoing(state.investorQuoteId, 'investor');
  }

  updateSplitState(paymentId, { status: 'COMPLETED', interactRef });
  return { payments: results };
}