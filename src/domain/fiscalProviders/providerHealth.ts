export type ProviderHealthStatus = 'healthy' | 'degraded' | 'disabled' | 'failed';
export type ProviderExternalConnectivityStatus = 'not_tested' | 'healthy' | 'degraded' | 'failed';

export type ProviderHealthResult = {
  ok: boolean;
  provider: string;
  environment: string;
  status: ProviderHealthStatus;
  externalConnectivity?: ProviderExternalConnectivityStatus;
  message?: string;
  checkedAt: Date;
};
