import { Types } from 'mongoose';

export type FiscalProviderInput = {
  transactionId: Types.ObjectId;
  invoiceDraftId: Types.ObjectId;
  invoiceQueueId: Types.ObjectId;
};

export type FiscalProviderValidationResult = {
  ok: boolean;
  message: string;
};

export type FiscalProviderIssueResult = {
  ok: boolean;
  providerStatus: 'issued' | 'failed';
  providerMessage: string;
  simulatedExternalId?: string;
};

export type FiscalProviderCancelResult = {
  ok: boolean;
  providerStatus: 'cancelled' | 'failed';
  providerMessage: string;
};

export interface FiscalProvider {
  name: string;
  validateInvoiceInput(input: FiscalProviderInput): Promise<FiscalProviderValidationResult>;
  issueInvoice(input: FiscalProviderInput): Promise<FiscalProviderIssueResult>;
  cancelInvoice(input: FiscalProviderInput): Promise<FiscalProviderCancelResult>;
}
