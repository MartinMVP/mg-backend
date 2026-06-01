import {
  FiscalProvider,
  FiscalProviderCancelResult,
  FiscalProviderInput,
  FiscalProviderIssueResult,
  FiscalProviderValidationResult,
} from './fiscalProvider.interface';

type MockFiscalProviderOptions = {
  validationShouldFail?: boolean;
  issueShouldFail?: boolean;
  cancelShouldFail?: boolean;
};

export class MockFiscalProvider implements FiscalProvider {
  name = 'mock';

  constructor(private readonly options: MockFiscalProviderOptions = {}) {}

  async validateInvoiceInput(_input: FiscalProviderInput): Promise<FiscalProviderValidationResult> {
    if (this.options.validationShouldFail) {
      return { ok: false, message: 'Mock validation failed' };
    }

    return { ok: true, message: 'Mock validation successful' };
  }

  async issueInvoice(input: FiscalProviderInput): Promise<FiscalProviderIssueResult> {
    if (this.options.issueShouldFail) {
      return {
        ok: false,
        providerStatus: 'failed',
        providerMessage: 'Mock invoice issue failed',
      };
    }

    return {
      ok: true,
      providerStatus: 'issued',
      providerMessage: 'Mock invoice issued',
      simulatedExternalId: `mock-${String(input.invoiceQueueId)}`,
    };
  }

  async cancelInvoice(_input: FiscalProviderInput): Promise<FiscalProviderCancelResult> {
    if (this.options.cancelShouldFail) {
      return {
        ok: false,
        providerStatus: 'failed',
        providerMessage: 'Mock cancellation failed',
      };
    }

    return {
      ok: true,
      providerStatus: 'cancelled',
      providerMessage: 'Mock cancellation successful',
    };
  }
}

export const mockFiscalProvider = new MockFiscalProvider();
