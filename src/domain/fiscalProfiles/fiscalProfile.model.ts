import { Schema, model, Types } from 'mongoose';

export interface IFiscalProfile {
  userId: Types.ObjectId;
  rfc: string;
  razonSocial: string;
  regimenFiscal: string;
  codigoPostal: string;
  usoCFDI: string;
}

const FiscalProfileSchema = new Schema<IFiscalProfile>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    rfc: { type: String, required: true, trim: true, uppercase: true },
    razonSocial: { type: String, required: true, trim: true },
    regimenFiscal: { type: String, required: true, trim: true },
    codigoPostal: { type: String, required: true, trim: true },
    usoCFDI: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

export const FiscalProfile = model<IFiscalProfile>('FiscalProfile', FiscalProfileSchema);
