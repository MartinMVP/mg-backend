import { Types } from 'mongoose';
import { FiscalSnapshot } from '../fiscalSnapshots/fiscalSnapshot.model';
import { InvoiceDraft } from '../invoiceDrafts/invoiceDraft.model';
import { Transaction } from '../transactions/transaction.model';

export type FiscalReadinessStatus = 'ready' | 'warning' | 'blocked';

export interface FiscalReadinessResult {
  status: FiscalReadinessStatus;
  issues: string[];
}

const rfcPattern = /^[A-Z0-9]{12,13}$/;
const postalCodePattern = /^\d{5}$/;

function getProfileValue(profile: any, key: string) {
  return typeof profile?.[key] === 'string' ? profile[key].trim() : '';
}

function validateFiscalProfile(prefix: 'buyer' | 'seller', profile: any, blockedIssues: string[], warningIssues: string[]) {
  const label = prefix === 'buyer' ? 'buyer' : 'seller';
  const rfc = getProfileValue(profile, 'rfc').toUpperCase();
  const codigoPostal = getProfileValue(profile, 'codigoPostal');
  const razonSocial = getProfileValue(profile, 'razonSocial');
  const emailFacturacion = getProfileValue(profile, 'emailFacturacion');

  if (!rfc || !rfcPattern.test(rfc)) {
    blockedIssues.push(`${label}_rfc_invalid`);
  }
  if (!codigoPostal || !postalCodePattern.test(codigoPostal)) {
    blockedIssues.push(`${label}_codigo_postal_invalid`);
  }
  if (!razonSocial) {
    blockedIssues.push(`${label}_razon_social_missing`);
  }
  if (!emailFacturacion) {
    warningIssues.push(`${label}_email_facturacion_missing`);
  }
}

export async function evaluateFiscalReadiness(transactionId: string | Types.ObjectId): Promise<FiscalReadinessResult> {
  if (!Types.ObjectId.isValid(String(transactionId))) {
    return { status: 'blocked', issues: ['transaction_not_found'] };
  }

  const transaction = await Transaction.findById(transactionId).lean();
  const blockedIssues: string[] = [];
  const warningIssues: string[] = [];

  if (!transaction) {
    return { status: 'blocked', issues: ['transaction_not_found'] };
  }

  if (transaction.status === 'cancelled') {
    blockedIssues.push('transaction_cancelled');
  } else if (transaction.status !== 'ready_for_invoice') {
    warningIssues.push('transaction_not_ready_for_invoice');
  }

  const [fiscalSnapshot, invoiceDraft] = await Promise.all([
    FiscalSnapshot.findOne({ transactionId: transaction._id }).lean(),
    InvoiceDraft.findOne({ transactionId: transaction._id }).lean(),
  ]);

  if (!fiscalSnapshot) {
    blockedIssues.push('fiscal_snapshot_missing');
  } else {
    if (!fiscalSnapshot.buyerFiscalProfile) {
      blockedIssues.push('buyer_fiscal_profile_missing');
    } else {
      validateFiscalProfile('buyer', fiscalSnapshot.buyerFiscalProfile, blockedIssues, warningIssues);
    }

    if (!fiscalSnapshot.sellerFiscalProfile) {
      blockedIssues.push('seller_fiscal_profile_missing');
    } else {
      validateFiscalProfile('seller', fiscalSnapshot.sellerFiscalProfile, blockedIssues, warningIssues);
    }
  }

  if (!invoiceDraft) {
    blockedIssues.push('invoice_draft_missing');
  } else if (invoiceDraft.status === 'cancelled') {
    blockedIssues.push('invoice_draft_cancelled');
  } else if (invoiceDraft.status !== 'ready') {
    warningIssues.push('invoice_draft_not_ready');
  }

  if (blockedIssues.length) {
    return { status: 'blocked', issues: blockedIssues };
  }

  if (warningIssues.length) {
    return { status: 'warning', issues: warningIssues };
  }

  return { status: 'ready', issues: [] };
}
