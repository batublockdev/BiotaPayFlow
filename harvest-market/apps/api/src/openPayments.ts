import { createAuthenticatedClient, createUnauthenticatedClient, type WalletAddress } from '@interledger/open-payments';

export type OpenPaymentsWalletRole = 'investor' | 'platform' | 'buyer' | 'grower';

export type OpenPaymentsConfig = {
  environment: 'sandbox' | 'production';
  clientWalletAddress: string;
  keyId: string;
  privateKeyPath: string;
  callbackUrl: string;
  fixedReceiveInterval: string;
  wallets: Partial<Record<OpenPaymentsWalletRole, string>>;
};

export type WalletDiagnostic = {
  role: OpenPaymentsWalletRole;
  id: string;
  assetCode: string;
  assetScale: number;
  hasAuthorizationServer: boolean;
  hasResourceServer: boolean;
};

const walletEnvironmentKeys: Record<OpenPaymentsWalletRole, string> = {
  investor: 'OPEN_PAYMENTS_INVESTOR_WALLET_ADDRESS',
  platform: 'OPEN_PAYMENTS_PLATFORM_WALLET_ADDRESS',
  buyer: 'OPEN_PAYMENTS_BUYER_WALLET_ADDRESS',
  grower: 'OPEN_PAYMENTS_GROWER_WALLET_ADDRESS'
};

export function normalizeWalletAddress(value: string): string {
  const normalized = value.startsWith('$') ? `https://${value.slice(1)}` : value;
  const parsed = new URL(normalized);
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new Error('Open Payments wallet addresses must use HTTPS');
  }
  return parsed.toString().replace(/\/$/, '');
}

export function getOpenPaymentsConfig(env: NodeJS.ProcessEnv = process.env): OpenPaymentsConfig {
  const environment = env.OPEN_PAYMENTS_ENVIRONMENT || 'sandbox';
  if (environment !== 'sandbox' && environment !== 'production') {
    throw new Error('OPEN_PAYMENTS_ENVIRONMENT must be sandbox or production');
  }

  const wallets: Partial<Record<OpenPaymentsWalletRole, string>> = {};
  for (const [role, envKey] of Object.entries(walletEnvironmentKeys) as [OpenPaymentsWalletRole, string][]) {
    const value = env[envKey]?.trim();
    if (value) wallets[role] = normalizeWalletAddress(value);
  }

  return {
    environment,
    clientWalletAddress: env.OPEN_PAYMENTS_CLIENT_WALLET_ADDRESS?.trim() || '',
    keyId: env.OPEN_PAYMENTS_KEY_ID?.trim() || '',
    privateKeyPath: env.OPEN_PAYMENTS_PRIVATE_KEY_PATH?.trim() || '',
    callbackUrl: env.OPEN_PAYMENTS_CALLBACK_URL?.trim() || '',
    fixedReceiveInterval: env.OPEN_PAYMENTS_FIXED_RECEIVE_INTERVAL?.trim() || 'R/P30D',
    wallets
  };
}

export function validateOpenPaymentsConfig(config = getOpenPaymentsConfig()): void {
  const missing = [
    ['OPEN_PAYMENTS_CLIENT_WALLET_ADDRESS', config.clientWalletAddress],
    ['OPEN_PAYMENTS_KEY_ID', config.keyId],
    ['OPEN_PAYMENTS_PRIVATE_KEY_PATH', config.privateKeyPath],
    ['OPEN_PAYMENTS_CALLBACK_URL', config.callbackUrl],
    ['OPEN_PAYMENTS_INVESTOR_WALLET_ADDRESS', config.wallets.investor],
    ['OPEN_PAYMENTS_PLATFORM_WALLET_ADDRESS', config.wallets.platform],
    ['OPEN_PAYMENTS_GROWER_WALLET_ADDRESS', config.wallets.grower]
  ].filter(([, value]) => !value).map(([key]) => key);

  if (missing.length) throw new Error(`Missing Open Payments configuration: ${missing.join(', ')}`);

  const callback = new URL(config.callbackUrl);
  if (callback.protocol !== 'https:' && callback.hostname !== 'localhost' && callback.hostname !== '127.0.0.1') {
    throw new Error('OPEN_PAYMENTS_CALLBACK_URL must use HTTPS outside local development');
  }
}

export function createOpenPaymentsClient(config = getOpenPaymentsConfig()) {
  validateOpenPaymentsConfig(config);
  return createAuthenticatedClient({
    walletAddressUrl: config.clientWalletAddress,
    keyId: config.keyId,
    privateKey: config.privateKeyPath
  });
}

export async function inspectConfiguredWallets(): Promise<WalletDiagnostic[]> {
  const config = getOpenPaymentsConfig();
  const client = await createUnauthenticatedClient({});
  const configured = Object.entries(config.wallets) as [OpenPaymentsWalletRole, string][];
  const wallets = await Promise.all(configured.map(async ([role, url]) => {
    const wallet = await client.walletAddress.get({ url }) as WalletAddress;
    return {
      role,
      id: wallet.id,
      assetCode: wallet.assetCode,
      assetScale: wallet.assetScale,
      hasAuthorizationServer: Boolean(wallet.authServer),
      hasResourceServer: Boolean(wallet.resourceServer)
    };
  }));
  return wallets;
}
