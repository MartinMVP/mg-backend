import { PacAdapter, PacAdapterConfigValidation } from './pacAdapter.interface';
import {
  PacCancelRequest,
  PacCancelResponse,
  PacIssueRequest,
  PacIssueResponse,
  PacStatusRequest,
  PacStatusResponse,
} from './pacAdapter.types';
import { mapPacError } from './pacError.mapper';

type MockPacAdapterOptions = {
  issueShouldFail?: boolean;
  cancelShouldFail?: boolean;
};

export class MockPacAdapter implements PacAdapter {
  name = 'mock-pac-adapter';

  constructor(private readonly options: MockPacAdapterOptions = {}) {}

  async issue(request: PacIssueRequest): Promise<PacIssueResponse> {
    const simulatedExternalId = `mock-${request.invoiceQueueId}`;

    if (this.options.issueShouldFail) {
      return {
        ok: false,
        providerStatus: 'failed',
        message: 'Mock invoice issue failed',
        providerRequestId: `mock-req-${request.invoiceQueueId}`,
        error: mapPacError('PAC_VALIDATION_ERROR', 'Mock invoice issue failed'),
      };
    }

    return {
      ok: true,
      providerStatus: 'issued',
      message: 'Mock invoice issued',
      providerReference: simulatedExternalId,
      providerRequestId: `mock-req-${request.invoiceQueueId}`,
      simulatedExternalId,
    };
  }

  async cancel(request: PacCancelRequest): Promise<PacCancelResponse> {
    if (this.options.cancelShouldFail) {
      return {
        ok: false,
        providerStatus: 'failed',
        message: 'Mock cancellation failed',
        providerRequestId: `mock-cancel-${request.invoiceQueueId}`,
        error: mapPacError('PAC_VALIDATION_ERROR', 'Mock cancellation failed'),
      };
    }

    return {
      ok: true,
      providerStatus: 'cancelled',
      message: 'Mock cancellation successful',
      providerReference: request.providerReference || `mock-${request.invoiceQueueId}`,
      providerRequestId: `mock-cancel-${request.invoiceQueueId}`,
    };
  }

  async getStatus(request: PacStatusRequest): Promise<PacStatusResponse> {
    return {
      ok: true,
      providerStatus: 'mock_status_available',
      message: 'Mock invoice status available',
      providerReference: request.providerReference || `mock-${request.invoiceQueueId}`,
    };
  }

  async validateConfig(): Promise<PacAdapterConfigValidation> {
    return { ok: true, issues: [] };
  }

  async checkHealth(environment = 'mock') {
    return {
      ok: true,
      provider: this.name,
      environment,
      status: 'healthy' as const,
      message: 'Mock PAC adapter healthy',
      checkedAt: new Date(),
    };
  }
}
