import { Schema, model } from 'mongoose';

export interface IAudit {
  actor: string;          // userId o sistema
  action: string;         // LOGIN | LOGOUT | REGISTER | REFRESH | ...
  ip?: string;
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AuditSchema = new Schema<IAudit>(
  {
    actor: { type: String, required: true, index: true },
    action: { type: String, required: true, index: true },
    ip: String,
    userAgent: String,
  },
  { timestamps: true }
);

export const Audit = model<IAudit>('Audit', AuditSchema);
