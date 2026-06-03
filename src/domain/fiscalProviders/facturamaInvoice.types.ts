import { Types } from 'mongoose';

export type FacturamaInvoiceDraftIssuer = {
  rfc: string;
  name: string;
  fiscalRegime: string;
  postalCode: string;
};

export type FacturamaInvoiceDraftReceiver = {
  rfc: string;
  name: string;
  fiscalRegime: string;
  postalCode: string;
  cfdiUse: string;
};

export type FacturamaInvoiceDraftConcept = {
  productCode: string;
  unitCode: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxObject: string;
};

export type FacturamaInvoiceDraftTotals = {
  subtotal: number;
  taxes: number;
  total: number;
  currency: string;
};

export type FacturamaInvoiceDraftMetadata = {
  source: 'provider_invoice_request';
  compatibility: 'facturama_draft_preview_only';
  transactionId: Types.ObjectId;
  invoiceRecordId: Types.ObjectId;
  providerOperationId?: string;
  idempotencyKey?: string;
};

export type FacturamaInvoiceDraftRequest = {
  issuer: FacturamaInvoiceDraftIssuer;
  receiver: FacturamaInvoiceDraftReceiver;
  concepts: FacturamaInvoiceDraftConcept[];
  totals: FacturamaInvoiceDraftTotals;
  expeditionPlace: string;
  metadata: FacturamaInvoiceDraftMetadata;
};

export type FacturamaDraftValidationResult = {
  valid: boolean;
  issues: string[];
};
