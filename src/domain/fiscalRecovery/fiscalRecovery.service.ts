import { Types } from 'mongoose';
import { FiscalSnapshot } from '../fiscalSnapshots/fiscalSnapshot.model';
import { InvoiceDraft } from '../invoiceDrafts/invoiceDraft.model';
import { Transaction } from '../transactions/transaction.model';

export interface FiscalRecoveryResult {
  recovered: boolean;
  issues: string[];
  transaction: unknown;
  invoiceDraft: unknown;
}

export async function recoverFiscalTransaction(transactionId: string | Types.ObjectId): Promise<FiscalRecoveryResult> {
  if (!Types.ObjectId.isValid(String(transactionId))) {
    return {
      recovered: false,
      issues: ['transaction_not_found'],
      transaction: null,
      invoiceDraft: null,
    };
  }

  const transaction = await Transaction.findById(transactionId);
  if (!transaction) {
    return {
      recovered: false,
      issues: ['transaction_not_found'],
      transaction: null,
      invoiceDraft: null,
    };
  }

  if (transaction.status === 'cancelled') {
    return {
      recovered: false,
      issues: ['transaction_cancelled'],
      transaction,
      invoiceDraft: await InvoiceDraft.findOne({ transactionId: transaction._id }).lean(),
    };
  }

  const fiscalSnapshot = await FiscalSnapshot.findOne({ transactionId: transaction._id }).lean();
  const issues: string[] = [];

  if (!fiscalSnapshot) issues.push('fiscal_snapshot_missing');
  if (fiscalSnapshot && !fiscalSnapshot.buyerFiscalProfile) {
    issues.push('fiscal_snapshot_buyer_profile_missing');
  }
  if (fiscalSnapshot && !fiscalSnapshot.sellerFiscalProfile) {
    issues.push('fiscal_snapshot_seller_profile_missing');
  }

  if (issues.length) {
    return {
      recovered: false,
      issues,
      transaction,
      invoiceDraft: await InvoiceDraft.findOne({ transactionId: transaction._id }).lean(),
    };
  }

  const updatedTransaction = await Transaction.findOneAndUpdate(
    { _id: transaction._id, status: { $ne: 'cancelled' } },
    { $set: { status: 'ready_for_invoice' } },
    { new: true, runValidators: true }
  );

  const invoiceDraft = await InvoiceDraft.findOneAndUpdate(
    { transactionId: transaction._id },
    {
      $setOnInsert: {
        transactionId: transaction._id,
        fiscalSnapshotId: fiscalSnapshot!._id,
        auctionResultId: transaction.auctionResultId,
        buyerId: transaction.buyerId,
        sellerId: transaction.sellerId,
        amount: transaction.amount,
        currency: 'MXN',
        status: 'ready',
        createdFromTransaction: true,
      },
    },
    { new: true, upsert: true, runValidators: true }
  );

  return {
    recovered: true,
    issues: [],
    transaction: updatedTransaction,
    invoiceDraft,
  };
}
