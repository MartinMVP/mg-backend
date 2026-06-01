import { Schema, model, Types } from 'mongoose';

export interface IFiscalProfile {
  userId: Types.ObjectId;
  rfc: string;
  razonSocial: string;
  regimenFiscal: string;
  codigoPostal: string;
  usoCFDI: string;
  emailFacturacion?: string;
  isValidated: boolean;
}

const FiscalProfileSchema = new Schema<IFiscalProfile>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    rfc: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      match: /^[A-Z0-9]{12,13}$/,
    },
    razonSocial: { type: String, required: true, trim: true },
    regimenFiscal: { type: String, required: true, trim: true },
    codigoPostal: { type: String, required: true, trim: true, match: /^\d{5}$/ },
    usoCFDI: { type: String, required: true, trim: true },
    emailFacturacion: { type: String, trim: true, lowercase: true },
    isValidated: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const FiscalProfile = model<IFiscalProfile>('FiscalProfile', FiscalProfileSchema);
