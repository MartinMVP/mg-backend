export type ProviderHealthStatus = 'healthy' | 'degraded' | 'disabled';

export type ProviderHealthResult = {
  ok: boolean;
  provider: string;
  environment: string;
  status: ProviderHealthStatus;
  message?: string;
  checkedAt: Date;
};
