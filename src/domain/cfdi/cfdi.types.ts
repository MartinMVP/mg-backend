import { Types } from 'mongoose';

export type CfdiIssuer = {
  rfc: string;
  name: string;
  regimenFiscal: string;
  postalCode: string;
};

export type CfdiReceiver = {
  rfc: string;
  name: string;
  regimenFiscal: string;
  postalCode: string;
  usoCFDI: string;
};

export type CfdiConcept = {
  description: string;
  productServiceKey: string;
  quantity: number;
  unitKey: string;
  unitPrice: number;
  amount: number;
  taxObject: string;
};

export type CfdiTotals = {
  subtotal: number;
  taxes: number;
  total: number;
  currency: 'MXN';
};

export type CfdiRequest = {
  transactionId: Types.ObjectId;
  invoiceRecordId: Types.ObjectId;
  issuer: CfdiIssuer;
  receiver: CfdiReceiver;
  concepts: CfdiConcept[];
  totals: CfdiTotals;
  currency: 'MXN';
};

export type CfdiValidationResult = {
  valid: boolean;
  issues: string[];
};
