import {
  FiscalProvider,
  FiscalProviderCancelResult,
  FiscalProviderInput,
  FiscalProviderIssueResult,
  FiscalProviderValidationResult,
} from './fiscalProvider.interface';
import { PacAdapter } from './pacAdapter.interface';
import { MockPacAdapter } from './mockPacAdapter';
import { mockProviderCapabilities } from './providerCapabilities';

type MockFiscalProviderOptions = {
  validationShouldFail?: boolean;
  issueShouldFail?: boolean;
  cancelShouldFail?: boolean;
  pacAdapter?: PacAdapter;
};

export class MockFiscalProvider implements FiscalProvider {
  name = 'mock';
  capabilities = mockProviderCapabilities;

  private readonly pacAdapter: PacAdapter;

  constructor(private readonly options: MockFiscalProviderOptions = {}) {
    this.pacAdapter = options.pacAdapter || new MockPacAdapter({
      issueShouldFail: options.issueShouldFail,
      cancelShouldFail: options.cancelShouldFail,
    });
  }

  async validateInvoiceInput(_input: FiscalProviderInput): Promise<FiscalProviderValidationResult> {
    if (this.options.validationShouldFail) {
      return { ok: false, message: 'Mock validation failed' };
    }

    return { ok: true, message: 'Mock validation successful' };
  }

  async issueInvoice(input: FiscalProviderInput): Promise<FiscalProviderIssueResult> {
    const result = await this.pacAdapter.issue({
      providerInvoiceRequest: input.providerInvoiceRequest,
      transactionId: String(input.transactionId),
      invoiceDraftId: String(input.invoiceDraftId),
      invoiceQueueId: String(input.invoiceQueueId),
    });
    return {
      ok: result.ok,
      providerStatus: result.providerStatus,
      providerMessage: result.message,
      providerReference: result.providerReference,
      providerRequestId: result.providerRequestId,
      simulatedExternalId: result.simulatedExternalId,
    };
  }

  async cancelInvoice(input: FiscalProviderInput): Promise<FiscalProviderCancelResult> {
    const result = await this.pacAdapter.cancel({
      transactionId: String(input.transactionId),
      invoiceDraftId: String(input.invoiceDraftId),
      invoiceQueueId: String(input.invoiceQueueId),
      providerReference: `mock-${String(input.invoiceQueueId)}`,
    });
    return {
      ok: result.ok,
      providerStatus: result.providerStatus,
      providerMessage: result.message,
      providerReference: result.providerReference,
      providerRequestId: result.providerRequestId,
    };
  }

  async getInvoiceStatus(input: FiscalProviderInput) {
    const result = await this.pacAdapter.getStatus({
      transactionId: String(input.transactionId),
      invoiceQueueId: String(input.invoiceQueueId),
      providerReference: `mock-${String(input.invoiceQueueId)}`,
    });

    return {
      ok: result.ok,
      providerStatus: result.providerStatus,
      providerMessage: result.message,
      providerReference: result.providerReference,
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
