import { Types } from 'mongoose';

export type ProviderInvoiceIssuer = {
  rfc: string;
  name: string;
  fiscalRegime: string;
  postalCode: string;
};

export type ProviderInvoiceReceiver = {
  rfc: string;
  name: string;
  fiscalRegime: string;
  postalCode: string;
  invoiceUse: string;
};

export type ProviderInvoiceConcept = {
  description: string;
  productServiceKey: string;
  quantity: number;
  unitKey: string;
  unitPrice: number;
  amount: number;
  taxObject: string;
};

export type ProviderInvoiceTotals = {
  subtotal: number;
  taxes: number;
  total: number;
  currency: string;
};

export type ProviderInvoiceMetadata = {
  source: 'internal_cfdi_request';
  transactionId: Types.ObjectId;
  invoiceRecordId: Types.ObjectId;
  providerOperationId?: string;
  idempotencyKey?: string;
};

export type ProviderInvoiceRequest = {
  transactionId: Types.ObjectId;
  invoiceRecordId: Types.ObjectId;
  issuer: ProviderInvoiceIssuer;
  receiver: ProviderInvoiceReceiver;
  concepts: ProviderInvoiceConcept[];
  totals: ProviderInvoiceTotals;
  metadata: ProviderInvoiceMetadata;
};
