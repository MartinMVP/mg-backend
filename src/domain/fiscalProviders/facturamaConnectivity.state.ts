import { ProviderExternalConnectivityStatus, ProviderHealthResult } from './providerHealth';

export type FacturamaConnectivitySnapshot = {
  status: ProviderExternalConnectivityStatus;
  message: string;
  checkedAt: Date | null;
  httpStatus?: number;
};

let lastConnectivity: FacturamaConnectivitySnapshot = {
  status: 'not_tested',
  message: 'Facturama connectivity has not been tested',
  checkedAt: null,
};

export function getFacturamaConnectivitySnapshot() {
  return { ...lastConnectivity };
}

export function setFacturamaConnectivitySnapshot(snapshot: FacturamaConnectivitySnapshot) {
  lastConnectivity = { ...snapshot };
  return getFacturamaConnectivitySnapshot();
}

export function resetFacturamaConnectivitySnapshot() {
  lastConnectivity = {
    status: 'not_tested',
    message: 'Facturama connectivity has not been tested',
    checkedAt: null,
  };
}

export function toFacturamaHealthResult(environment: string): ProviderHealthResult {
  const snapshot = getFacturamaConnectivitySnapshot();
  const status = snapshot.status === 'healthy'
    ? 'healthy'
    : snapshot.status === 'not_tested'
      ? 'degraded'
      : 'failed';

  return {
    ok: snapshot.status === 'healthy',
    provider: 'facturama',
    environment,
    status,
    externalConnectivity: snapshot.status,
    message: snapshot.message,
    checkedAt: snapshot.checkedAt || new Date(),
  };
}
