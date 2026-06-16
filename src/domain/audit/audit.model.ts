import { Schema, model, Types } from 'mongoose';

export interface IAudit {
  actor: string;          // userId o sistema
  action: string;         // LOGIN | LOGOUT | REGISTER | REFRESH | ...
  ip?: string;
  userAgent?: string;
  transactionId?: Types.ObjectId;
  invoiceRecordId?: Types.ObjectId;
  invoiceQueueId?: Types.ObjectId;
  conversationId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AuditSchema = new Schema<IAudit>(
  {
    actor: { type: String, required: true, index: true },
    action: { type: String, required: true, index: true },
    ip: String,
    userAgent: String,
    transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', index: true },
    invoiceRecordId: { type: Schema.Types.ObjectId, ref: 'InvoiceRecord', index: true },
    invoiceQueueId: { type: Schema.Types.ObjectId, ref: 'InvoiceQueue', index: true },
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', index: true },
  },
  { timestamps: true }
);

export const Audit = model<IAudit>('Audit', AuditSchema);
