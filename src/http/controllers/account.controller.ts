import { Request, Response } from 'express';
import { AuctionResult } from '../../domain/auctionResults/auctionResult.model';
import { FiscalProfile } from '../../domain/fiscalProfiles/fiscalProfile.model';

function auctionResultPopulate(includeBuyer = false) {
  const populate: any[] = [
    { path: 'auctionId' },
    {
      path: 'listingId',
      populate: {
        path: 'animal',
        populate: { path: 'breed' },
      },
    },
  ];

  if (includeBuyer) {
    populate.push({ path: 'buyerId', select: 'name' });
  }

  return populate;
}

export async function listPurchases(req: Request, res: Response) {
  const user = (req as any).user;

  const items = await AuctionResult.find({ buyerId: user.sub })
    .sort({ closedAt: -1 })
    .populate(auctionResultPopulate(false))
    .lean();

  res.json(items);
}

export async function listSales(req: Request, res: Response) {
  const user = (req as any).user;

  const items = await AuctionResult.find({ sellerId: user.sub })
    .sort({ closedAt: -1 })
    .populate(auctionResultPopulate(true))
    .lean();

  res.json(items);
}

export async function getFiscalProfile(req: Request, res: Response) {
  const user = (req as any).user;
  const profile = await FiscalProfile.findOne({ userId: user.sub }).lean();

  res.json(profile);
}

export async function upsertFiscalProfile(req: Request, res: Response) {
  const user = (req as any).user;
  const { rfc, razonSocial, regimenFiscal, codigoPostal, usoCFDI } = req.body || {};

  if (!rfc || !razonSocial || !regimenFiscal || !codigoPostal || !usoCFDI) {
    return res.status(400).json({ error: 'Campos fiscales requeridos' });
  }

  const profile = await FiscalProfile.findOneAndUpdate(
    { userId: user.sub },
    {
      $set: {
        rfc,
        razonSocial,
        regimenFiscal,
        codigoPostal,
        usoCFDI,
      },
    },
    { new: true, upsert: true, runValidators: true }
  );

  res.json(profile);
}
