export function allocation(principal: number, revenue: number, shareBps: number, feeBps = 300) {
  if (![principal, revenue, shareBps, feeBps].every(Number.isSafeInteger) || principal <= 0 || revenue < principal || shareBps < 0 || feeBps < 0 || shareBps + feeBps > 10000) throw new Error('Distribution requires sales covering principal and valid split terms; losses require manual review.');
  const profit = revenue - principal;
  const royalty = Number(BigInt(profit) * BigInt(shareBps) / 10000n);
  const commission = Number(BigInt(revenue) * BigInt(feeBps) / 10000n);
  const farmer = principal + profit - (principal + royalty) - commission;
  if (farmer < 0) throw new Error('The sale cannot cover the agreed investor return and marketplace commission.');
  return { principal, revenue, profit, royalty, commission, investor: principal + royalty, farmer };
}
