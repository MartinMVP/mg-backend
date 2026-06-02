export type ProviderCapabilities = {
  validateInvoiceInput: boolean;
  issueInvoice: boolean;
  cancelInvoice: boolean;
  getInvoiceStatus: boolean;
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
  sandboxSupported: true,
  productionSupported: false,
  traceSupported: false,
  retrySupported: false,
};
