import { ProviderInvoiceRequest } from './providerInvoice.types';

export type PacErrorCode =
  | 'PAC_TIMEOUT'
  | 'PAC_VALIDATION_ERROR'
  | 'PAC_AUTH_ERROR'
  | 'PAC_UNKNOWN_ERROR';

export type PacError = {
  code: PacErrorCode;
  message: string;
  retryable: boolean;
};

export type PacIssueRequest = {
  providerInvoiceRequest?: ProviderInvoiceRequest;
  transactionId: string;
  invoiceQueueId: string;
  invoiceDraftId: string;
  providerOperationId?: string;
  idempotencyKey?: string;
};

export type PacIssueResponse = {
  ok: boolean;
  providerStatus: 'issued' | 'failed';
  message: string;
  providerReference?: string;
  providerRequestId?: string;
  simulatedExternalId?: string;
  error?: PacError;
};

export type PacCancelRequest = {
  providerReference?: string;
  transactionId: string;
  invoiceQueueId: string;
  invoiceDraftId: string;
  providerOperationId?: string;
  idempotencyKey?: string;
};

export type PacCancelResponse = {
  ok: boolean;
  providerStatus: 'cancelled' | 'failed';
  message: string;
  providerReference?: string;
  providerRequestId?: string;
  error?: PacError;
};

export type PacStatusRequest = {
  providerReference?: string;
  transactionId: string;
  invoiceQueueId: string;
};

export type PacStatusResponse = {
  ok: boolean;
  providerStatus: string;
  message: string;
  providerReference?: string;
  error?: PacError;
};
