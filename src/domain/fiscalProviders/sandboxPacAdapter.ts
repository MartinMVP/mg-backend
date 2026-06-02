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

export class SandboxPacAdapter implements PacAdapter {
  name = 'sandbox-pac-adapter';

  private notConfiguredError(message = 'Sandbox PAC adapter is not configured') {
    return mapPacError('PAC_AUTH_ERROR', message);
  }

  async issue(_request: PacIssueRequest): Promise<PacIssueResponse> {
    return {
      ok: false,
      providerStatus: 'failed',
      message: 'Sandbox PAC adapter is disabled and not configured',
      error: this.notConfiguredError(),
    };
  }

  async cancel(_request: PacCancelRequest): Promise<PacCancelResponse> {
    return {
      ok: false,
      providerStatus: 'failed',
      message: 'Sandbox PAC adapter is disabled and not configured',
      error: this.notConfiguredError(),
    };
  }

  async getStatus(_request: PacStatusRequest): Promise<PacStatusResponse> {
    return {
      ok: false,
      providerStatus: 'failed',
      message: 'Sandbox PAC adapter is disabled and not configured',
      error: this.notConfiguredError(),
    };
  }

  async validateConfig(): Promise<PacAdapterConfigValidation> {
    return {
      ok: false,
      issues: ['provider_disabled', 'missing_sandbox_api_url', 'missing_sandbox_credentials'],
    };
  }

  async checkHealth(environment = 'sandbox') {
    return {
      ok: false,
      provider: this.name,
      environment,
      status: 'disabled' as const,
      message: 'Sandbox PAC adapter stub is disabled and makes no external calls',
      checkedAt: new Date(),
    };
  }
}
