import { Schema, model, Types } from 'mongoose';

export interface ISession {
  user: Types.ObjectId;     // dueño del refresh
  jti: string;              // identificador único del refresh (UUID)
  tokenHash: string;        // hash del refresh token
  userAgent?: string;
  ip?: string;
  isRevoked: boolean;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;          // para TTL (auto-expira en Mongo)
}

const SessionSchema = new Schema<ISession>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    jti: { type: String, required: true, index: true, unique: true },
    tokenHash: { type: String, required: true },
    userAgent: { type: String },
    ip: { type: String },
    isRevoked: { type: Boolean, default: false },
    // TTL: cuando llega la fecha, Mongo borra el doc automáticamente
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true }
);

export const Session = model<ISession>('Session', SessionSchema);
