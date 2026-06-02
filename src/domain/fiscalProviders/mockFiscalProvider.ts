import {
  FiscalProvider,
  FiscalProviderCancelResult,
  FiscalProviderInput,
  FiscalProviderIssueResult,
  FiscalProviderValidationResult,
} from './fiscalProvider.interface';
import { mockProviderCapabilities } from './providerCapabilities';

type MockFiscalProviderOptions = {
  validationShouldFail?: boolean;
  issueShouldFail?: boolean;
  cancelShouldFail?: boolean;
};

export class MockFiscalProvider implements FiscalProvider {
  name = 'mock';
  capabilities = mockProviderCapabilities;

  constructor(private readonly options: MockFiscalProviderOptions = {}) {}

  async validateInvoiceInput(_input: FiscalProviderInput): Promise<FiscalProviderValidationResult> {
    if (this.options.validationShouldFail) {
      return { ok: false, message: 'Mock validation failed' };
    }

    return { ok: true, message: 'Mock validation successful' };
  }

  async issueInvoice(input: FiscalProviderInput): Promise<FiscalProviderIssueResult> {
    const simulatedExternalId = `mock-${String(input.invoiceQueueId)}`;

    if (this.options.issueShouldFail) {
      return {
        ok: false,
        providerStatus: 'failed',
        providerMessage: 'Mock invoice issue failed',
        providerRequestId: `mock-req-${String(input.invoiceQueueId)}`,
      };
    }

    return {
      ok: true,
      providerStatus: 'issued',
      providerMessage: 'Mock invoice issued',
      providerReference: simulatedExternalId,
      providerRequestId: `mock-req-${String(input.invoiceQueueId)}`,
      simulatedExternalId,
    };
  }

  async cancelInvoice(input: FiscalProviderInput): Promise<FiscalProviderCancelResult> {
    if (this.options.cancelShouldFail) {
      return {
        ok: false,
        providerStatus: 'failed',
        providerMessage: 'Mock cancellation failed',
        providerRequestId: `mock-cancel-${String(input.invoiceQueueId)}`,
      };
    }

    return {
      ok: true,
      providerStatus: 'cancelled',
      providerMessage: 'Mock cancellation successful',
      providerReference: `mock-${String(input.invoiceQueueId)}`,
      providerRequestId: `mock-cancel-${String(input.invoiceQueueId)}`,
    };
  }

  async getInvoiceStatus(input: FiscalProviderInput) {
    return {
      ok: true,
      providerStatus: 'mock_status_available',
      providerMessage: 'Mock invoice status available',
      providerReference: `mock-${String(input.invoiceQueueId)}`,
    };
  }

  async checkHealth(environment = 'mock') {
    return {
      ok: true,
      provider: this.name,
      environment,
      status: 'healthy' as const,
      message: 'Mock fiscal provider healthy',
      checkedAt: new Date(),
    };
  }
}

export const mockFiscalProvider = new MockFiscalProvider();
