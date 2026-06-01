import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { AuctionResult, AuctionResultStatus } from '../../domain/auctionResults/auctionResult.model';
import { Audit } from '../../domain/audit/audit.model';
import { FiscalProfile } from '../../domain/fiscalProfiles/fiscalProfile.model';
import { FiscalSnapshot } from '../../domain/fiscalSnapshots/fiscalSnapshot.model';
import { InvoiceDraft } from '../../domain/invoiceDrafts/invoiceDraft.model';
import { Notification } from '../../domain/notifications/notification.model';
import { Transaction } from '../../domain/transactions/transaction.model';

const terminalStatuses: AuctionResultStatus[] = [
  'sale_confirmed',
  'sale_cancelled',
  'in_dispute',
];

function canManageSale(user: any, result: any) {
  return (
    String(result.sellerId) === String(user?.sub) ||
    user?.role === 'admin' ||
    user?.role === 'super'
  );
}

async function createFiscalBaseForConfirmedSale(result: any) {
  const [buyerFiscalProfile, sellerFiscalProfile] = await Promise.all([
    FiscalProfile.findOne({ userId: result.buyerId }).lean(),
    FiscalProfile.findOne({ userId: result.sellerId }).lean(),
  ]);
  const transactionStatus =
    buyerFiscalProfile && sellerFiscalProfile ? 'ready_for_invoice' : 'pending';

  const transaction = await Transaction.findOneAndUpdate(
    { auctionResultId: result._id },
    {
      $setOnInsert: {
        auctionResultId: result._id,
        buyerId: result.buyerId,
        sellerId: result.sellerId,
        amount: result.finalPrice,
      },
      $set: { status: transactionStatus },
    },
    { new: true, upsert: true, runValidators: true }
  );

  const fiscalSnapshot = await FiscalSnapshot.findOneAndUpdate(
    { transactionId: transaction._id },
    {
      $setOnInsert: {
        transactionId: transaction._id,
        auctionResultId: result._id,
        buyerId: result.buyerId,
        sellerId: result.sellerId,
        buyerFiscalProfile: buyerFiscalProfile || null,
        sellerFiscalProfile: sellerFiscalProfile || null,
        amount: result.finalPrice,
        currency: 'MXN',
      },
    },
    { new: true, upsert: true, runValidators: true }
  );

  if (transaction.status === 'ready_for_invoice') {
    await InvoiceDraft.findOneAndUpdate(
      { transactionId: transaction._id },
      {
        $setOnInsert: {
          transactionId: transaction._id,
          fiscalSnapshotId: fiscalSnapshot._id,
          auctionResultId: result._id,
          buyerId: result.buyerId,
          sellerId: result.sellerId,
          amount: result.finalPrice,
          currency: 'MXN',
          status: 'ready',
          createdFromTransaction: true,
        },
      },
      { new: true, upsert: true, runValidators: true }
    );
  }
}

async function updateSaleStatus(req: Request, res: Response, status: 'sale_confirmed' | 'sale_cancelled') {
  const user = (req as any).user;
  const id = String(req.params.id);

  if (!Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid sale id' });
  }

  const current = await AuctionResult.findById(id);
  if (!current) return res.status(404).json({ error: 'Not found' });

  if (!canManageSale(user, current)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (terminalStatuses.includes(current.status)) {
    return res.status(409).json({ error: 'Sale already finalized' });
  }

  const updated = await AuctionResult.findOneAndUpdate(
    { _id: current._id, status: { $nin: terminalStatuses } },
    { $set: { status } },
    { new: true }
  );

  if (!updated) return res.status(409).json({ error: 'Sale already finalized' });

  const confirmed = status === 'sale_confirmed';

  if (confirmed) {
    await createFiscalBaseForConfirmedSale(updated);
  } else {
    await Transaction.findOneAndUpdate(
      { auctionResultId: updated._id },
      { $set: { status: 'cancelled' } },
      { new: true }
    );
    await InvoiceDraft.findOneAndUpdate(
      { auctionResultId: updated._id },
      { $set: { status: 'cancelled' } },
      { new: true }
    );
  }

  await Notification.create({
    userId: updated.buyerId,
    type: confirmed ? 'sale_confirmed' : 'sale_cancelled',
    title: confirmed ? 'Venta confirmada' : 'Venta cancelada',
    message: confirmed
      ? 'El vendedor confirmó la venta de la subasta.'
      : 'El vendedor canceló la venta de la subasta.',
  });

  await Audit.create({
    actor: user?.sub,
    action: 'SALE_STATUS',
    entity: 'AuctionResult',
    entityId: updated._id,
    payload: { to: status },
  });

  res.json(updated);
}

export async function confirmSale(req: Request, res: Response) {
  return updateSaleStatus(req, res, 'sale_confirmed');
}

export async function cancelSale(req: Request, res: Response) {
  return updateSaleStatus(req, res, 'sale_cancelled');
}
