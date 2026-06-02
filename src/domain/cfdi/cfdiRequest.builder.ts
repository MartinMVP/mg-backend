import { Types } from 'mongoose';
import { IFiscalSnapshot } from '../fiscalSnapshots/fiscalSnapshot.model';
import { IInvoiceDraft } from '../invoiceDrafts/invoiceDraft.model';
import { IInvoiceRecord } from '../invoiceRecords/invoiceRecord.model';
import { ITransaction } from '../transactions/transaction.model';
import {
  INTERNAL_CFDI_DEFAULT_PRODUCT_SERVICE_KEY,
  INTERNAL_CFDI_DEFAULT_UNIT_KEY,
} from './cfdiCatalogs';
import { CfdiRequest } from './cfdi.types';

type FiscalProfileSnapshot = {
  rfc?: string;
  razonSocial?: string;
  regimenFiscal?: string;
  codigoPostal?: string;
  usoCFDI?: string;
};

type BuildCfdiRequestInput = {
  transaction: ITransaction & { _id: Types.ObjectId };
  fiscalSnapshot: IFiscalSnapshot;
  invoiceDraft: IInvoiceDraft;
  invoiceRecord: IInvoiceRecord & { _id: Types.ObjectId };
};

function normalizeFiscalProfile(value: unknown): FiscalProfileSnapshot {
  if (!value || typeof value !== 'object') return {};
  return value as FiscalProfileSnapshot;
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function buildCfdiRequest(input: BuildCfdiRequestInput): CfdiRequest {
  const buyerProfile = normalizeFiscalProfile(input.fiscalSnapshot.buyerFiscalProfile);
  const sellerProfile = normalizeFiscalProfile(input.fiscalSnapshot.sellerFiscalProfile);
  const amount = input.invoiceDraft.amount || input.fiscalSnapshot.amount || input.transaction.amount;

  return {
    transactionId: input.transaction._id,
    invoiceRecordId: input.invoiceRecord._id,
    issuer: {
      rfc: normalizeText(sellerProfile.rfc),
      name: normalizeText(sellerProfile.razonSocial),
      regimenFiscal: normalizeText(sellerProfile.regimenFiscal),
      postalCode: normalizeText(sellerProfile.codigoPostal),
    },
    receiver: {
      rfc: normalizeText(buyerProfile.rfc),
      name: normalizeText(buyerProfile.razonSocial),
      regimenFiscal: normalizeText(buyerProfile.regimenFiscal),
      postalCode: normalizeText(buyerProfile.codigoPostal),
      usoCFDI: normalizeText(buyerProfile.usoCFDI),
    },
    concepts: [
      {
        description: 'Operacion Mercado Ganadero',
        productServiceKey: INTERNAL_CFDI_DEFAULT_PRODUCT_SERVICE_KEY,
        quantity: 1,
        unitKey: INTERNAL_CFDI_DEFAULT_UNIT_KEY,
        unitPrice: amount,
        amount,
        taxObject: '02',
      },
    ],
    totals: {
      subtotal: amount,
      taxes: 0,
      total: amount,
      currency: input.invoiceDraft.currency,
    },
    currency: input.invoiceDraft.currency,
  };
}
