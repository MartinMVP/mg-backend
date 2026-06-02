import {
  FiscalProvider,
  FiscalProviderCancelResult,
  FiscalProviderInput,
  FiscalProviderIssueResult,
  FiscalProviderStatusResult,
  FiscalProviderValidationResult,
} from './fiscalProvider.interface';
import { FiscalProviderConfig } from './fiscalProvider.config';
import { sandboxPacProviderCapabilities } from './providerCapabilities';
import { ProviderHealthResult } from './providerHealth';
import { PacAdapter } from './pacAdapter.interface';
import { SandboxPacAdapter } from './sandboxPacAdapter';
import { ProviderHttpClient } from './providerHttpClient.interface';
import { SandboxHttpClientStub } from './sandboxHttpClient.stub';

type SandboxFiscalProviderOptions = {
  config: FiscalProviderConfig;
  adapter?: PacAdapter;
  httpClient?: ProviderHttpClient;
  readinessIssues?: string[];
};

export class SandboxFiscalProvider implements FiscalProvider {
  name = 'sandbox-pac';
  capabilities = sandboxPacProviderCapabilities;
  version = 'sandbox-skeleton-v1';
  externalConnectivity = 'not_tested' as const;
  private readonly adapter: PacAdapter;
  private readonly httpClient: ProviderHttpClient;
  private readonly readinessIssues: string[];

  constructor(private readonly options: SandboxFiscalProviderOptions) {
    this.adapter = options.adapter || new SandboxPacAdapter();
    this.httpClient = options.httpClient || new SandboxHttpClientStub();
    this.readinessIssues = options.readinessIssues || [];
  }

  async validateInvoiceInput(_input: FiscalProviderInput): Promise<FiscalProviderValidationResult> {
    if (!this.isReady()) {
      return { ok: false, message: this.readinessMessage('sandbox_not_ready') };
    }

    return { ok: false, message: 'sandbox_not_enabled_for_real_fiscal_operations' };
  }

  async issueInvoice(input: FiscalProviderInput): Promise<FiscalProviderIssueResult> {
    if (!this.isReady()) {
      return {
        ok: false,
        providerStatus: 'failed',
        providerMessage: this.readinessMessage('sandbox_not_ready'),
        providerRequestId: input.idempotencyKey,
      };
    }

    const response = await this.adapter.issue({
      transactionId: String(input.transactionId),
      invoiceDraftId: String(input.invoiceDraftId),
      invoiceQueueId: String(input.invoiceQueueId),
      providerOperationId: input.providerOperationId,
      idempotencyKey: input.idempotencyKey,
      providerInvoiceRequest: input.providerInvoiceRequest,
    });

    return {
      ok: false,
      providerStatus: 'failed',
      providerMessage: response.message || 'sandbox_not_enabled_for_real_fiscal_operations',
      providerRequestId: response.providerRequestId || input.idempotencyKey,
      providerReference: response.providerReference,
    };
  }

  async cancelInvoice(input: FiscalProviderInput): Promise<FiscalProviderCancelResult> {
    if (!this.isReady()) {
      return {
        ok: false,
        providerStatus: 'failed',
        providerMessage: this.readinessMessage('sandbox_not_ready'),
        providerRequestId: input.idempotencyKey,
      };
    }

    const response = await this.adapter.cancel({
      transactionId: String(input.transactionId),
      invoiceDraftId: String(input.invoiceDraftId),
      invoiceQueueId: String(input.invoiceQueueId),
      providerOperationId: input.providerOperationId,
      idempotencyKey: input.idempotencyKey,
    });

    return {
      ok: false,
      providerStatus: 'failed',
      providerMessage: response.message || 'sandbox_not_enabled_for_real_fiscal_operations',
      providerRequestId: response.providerRequestId || input.idempotencyKey,
      providerReference: response.providerReference,
    };
  }

  async getInvoiceStatus(input: FiscalProviderInput): Promise<FiscalProviderStatusResult> {
    if (!this.isReady()) {
      return {
        ok: false,
        providerStatus: 'failed',
        providerMessage: this.readinessMessage('sandbox_not_ready'),
      };
    }

    const response = await this.adapter.getStatus({
      transactionId: String(input.transactionId),
      invoiceQueueId: String(input.invoiceQueueId),
    });

    return {
      ok: false,
      providerStatus: response.providerStatus,
      providerMessage: response.message || 'sandbox_not_enabled_for_real_fiscal_operations',
      providerReference: response.providerReference,
    };
  }

  async checkHealth(environment = this.options.config.environment): Promise<ProviderHealthResult> {
    return {
      ok: this.isReady(),
      provider: this.name,
      environment,
      status: this.isReady() ? 'degraded' : 'disabled',
      message: this.isReady()
        ? 'Sandbox PAC provider skeleton is configured; external connectivity not tested'
        : this.readinessMessage('sandbox_not_configured'),
      checkedAt: new Date(),
    };
  }

  getStatus() {
    return {
      provider: this.name,
      version: this.version,
      enabled: this.options.config.enabled,
      environment: this.options.config.environment,
      externalConnectivity: this.externalConnectivity,
      readiness: {
        ready: this.isReady(),
        issues: this.readinessIssues,
      },
    };
  }

  getHttpClient() {
    return this.httpClient;
  }

  private isReady() {
    return this.options.config.enabled && this.readinessIssues.length === 0;
  }

  private readinessMessage(fallback: string) {
    return this.readinessIssues.length > 0
      ? this.readinessIssues.join(',')
      : fallback;
  }
}
