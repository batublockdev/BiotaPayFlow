/** Boundary for a future provider-backed implementation. No live provider is configured. */
export interface PaymentInstruction {
 reference: string;
 amountMinor: number;
 currency: 'USD' | 'EUR';
 payer: string;
 recipient: string;
}
export interface PaymentReceipt { reference: string; provider: string; status: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'SIMULATED_COMPLETED' }
export interface PaymentProvider { request(instruction: PaymentInstruction): Promise<PaymentReceipt>; status(reference:string):Promise<PaymentReceipt> }
/** This intentionally rejects live use rather than misrepresenting mock payments as Open Payments. */
export class OpenPaymentsNotConfigured implements PaymentProvider {
 async request(_instruction: PaymentInstruction):Promise<PaymentReceipt> { throw new Error('Configure wallet provider, grants, credentials, payment confirmation and fees before enabling live payments.'); }
 async status(_reference:string):Promise<PaymentReceipt> { throw new Error('Live Open Payments integration is not configured.'); }
}
