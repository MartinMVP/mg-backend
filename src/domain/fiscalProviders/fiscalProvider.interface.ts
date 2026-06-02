import { Types } from 'mongoose';
import { CfdiRequest } from '../cfdi/cfdi.types';
import { ProviderCapabilities } from './providerCapabilities';
import { ProviderHealthResult } from './providerHealth';
import { ProviderInvoiceRequest } from './providerInvoice.types';

export type FiscalProviderInput = {
  transactionId: Types.ObjectId;
  invoiceDraftId: Types.ObjectId;
  invoiceQueueId: Types.ObjectId;
  cfdiRequest?: CfdiRequest;
  providerInvoiceRequest?: ProviderInvoiceRequest;
};

export type FiscalProviderValidationResult = {
  ok: boolean;
  message: string;
};

export type FiscalProviderIssueResult = {
  ok: boolean;
  providerStatus: 'issued' | 'failed';
  providerMessage: string;
  providerReference?: string;
  providerRequestId?: string;
  simulatedExternalId?: string;
};

export type FiscalProviderCancelResult = {
  ok: boolean;
  providerStatus: 'cancelled' | 'failed';
  providerMessage: string;
  providerReference?: string;
  providerRequestId?: string;
};

export type FiscalProviderStatusResult = {
  ok: boolean;
  providerStatus: string;
  providerMessage: string;
  providerReference?: string;
};

export interface FiscalProvider {
  name: string;
  capabilities: ProviderCapabilities;
  validateInvoiceInput(input: FiscalProviderInput): Promise<FiscalProviderValidationResult>;
  issueInvoice(input: FiscalProviderInput): Promise<FiscalProviderIssueResult>;
  cancelInvoice(input: FiscalProviderInput): Promise<FiscalProviderCancelResult>;
  getInvoiceStatus(input: FiscalProviderInput): Promise<FiscalProviderStatusResult>;
  checkHealth(environment?: string): Promise<ProviderHealthResult>;
}
