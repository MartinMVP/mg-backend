import { ProviderHealthResult } from './providerHealth';
import {
  PacCancelRequest,
  PacCancelResponse,
  PacIssueRequest,
  PacIssueResponse,
  PacStatusRequest,
  PacStatusResponse,
} from './pacAdapter.types';

export type PacAdapterConfigValidation = {
  ok: boolean;
  issues: string[];
};

export interface PacAdapter {
  name: string;
  issue(request: PacIssueRequest): Promise<PacIssueResponse>;
  cancel(request: PacCancelRequest): Promise<PacCancelResponse>;
  getStatus(request: PacStatusRequest): Promise<PacStatusResponse>;
  validateConfig?(): Promise<PacAdapterConfigValidation>;
  checkHealth?(environment?: string): Promise<ProviderHealthResult>;
}
