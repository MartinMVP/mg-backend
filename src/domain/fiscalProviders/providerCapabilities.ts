export type ProviderCapabilities = {
  validateInvoiceInput: boolean;
  issueInvoice: boolean;
  cancelInvoice: boolean;
  getInvoiceStatus: boolean;
  externalConnectivity?: 'not_supported' | 'not_tested' | 'available';
  sandboxSupported: boolean;
  productionSupported: boolean;
  traceSupported: boolean;
  retrySupported: boolean;
};

export const mockProviderCapabilities: ProviderCapabilities = {
  validateInvoiceInput: true,
  issueInvoice: true,
  cancelInvoice: true,
  getInvoiceStatus: true,
  externalConnectivity: 'not_supported',
  sandboxSupported: true,
  productionSupported: false,
  traceSupported: true,
  retrySupported: true,
};

export const disabledFutureProviderCapabilities: ProviderCapabilities = {
  validateInvoiceInput: false,
  issueInvoice: false,
  cancelInvoice: false,
  getInvoiceStatus: false,
  externalConnectivity: 'not_tested',
  sandboxSupported: true,
  productionSupported: false,
  traceSupported: false,
  retrySupported: false,
};

export const sandboxPacProviderCapabilities: ProviderCapabilities = {
  validateInvoiceInput: true,
  issueInvoice: true,
  cancelInvoice: true,
  getInvoiceStatus: true,
  externalConnectivity: 'not_tested',
  sandboxSupported: true,
  productionSupported: false,
  traceSupported: true,
  retrySupported: true,
};
