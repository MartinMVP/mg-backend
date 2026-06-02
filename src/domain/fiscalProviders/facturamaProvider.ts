import {
  FiscalProvider,
  FiscalProviderCancelResult,
  FiscalProviderInput,
  FiscalProviderIssueResult,
  FiscalProviderStatusResult,
  FiscalProviderValidationResult,
} from './fiscalProvider.interface';
import { FiscalProviderConfig } from './fiscalProvider.config';
import { facturamaProviderCapabilities } from './providerCapabilities';
import { ProviderHealthResult } from './providerHealth';

type FacturamaProviderOptions = {
  config: FiscalProviderConfig;
  readinessIssues?: string[];
};

export class FacturamaProvider implements FiscalProvider {
  name = 'facturama';
  capabilities = facturamaProviderCapabilities;
  version = 'facturama-selection-v1';
  private readonly readinessIssues: string[];

  constructor(private readonly options: FacturamaProviderOptions) {
    this.readinessIssues = options.readinessIssues || [];
  }

  async validateInvoiceInput(_input: FiscalProviderInput): Promise<FiscalProviderValidationResult> {
    return {
      ok: false,
      message: this.message('provider_not_ready'),
    };
  }

  async issueInvoice(input: FiscalProviderInput): Promise<FiscalProviderIssueResult> {
    return {
      ok: false,
      providerStatus: 'failed',
      providerMessage: this.message('provider_not_enabled'),
      providerRequestId: input.idempotencyKey,
    };
  }

  async cancelInvoice(input: FiscalProviderInput): Promise<FiscalProviderCancelResult> {
    return {
      ok: false,
      providerStatus: 'failed',
      providerMessage: this.message('provider_not_enabled'),
      providerRequestId: input.idempotencyKey,
    };
  }

  async getInvoiceStatus(_input: FiscalProviderInput): Promise<FiscalProviderStatusResult> {
    return {
      ok: false,
      providerStatus: 'failed',
      providerMessage: this.message('provider_not_ready'),
    };
  }

  async checkHealth(environment = this.options.config.environment): Promise<ProviderHealthResult> {
    return {
      ok: false,
      provider: this.name,
      environment,
      status: 'disabled',
      message: this.message('facturama_not_configured'),
      checkedAt: new Date(),
    };
  }

  private message(fallback: string) {
    return this.readinessIssues.length > 0
      ? this.readinessIssues.join(',')
      : fallback;
  }
}
