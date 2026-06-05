import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { Notification, NotificationType } from '../notifications/notification.model';
import { paymentAuditActions } from './payment.audit';

type MembershipNoticeKey =
  | 'payment_failed'
  | 'grace_period_started'
  | 'dunning_started'
  | 'dunning_retry'
  | 'recovered'
  | 'suspended'
  | 'cancelled';

const noticeContent: Record<MembershipNoticeKey, {
  type: NotificationType;
  auditAction: string;
  title: string;
  message: string;
}> = {
  payment_failed: {
    type: 'membership_payment_failed',
    auditAction: paymentAuditActions.paymentFailedNotice,
    title: 'Pago de membresia no procesado',
    message: 'No pudimos procesar el pago de tu membresia. Tus beneficios continuan temporalmente durante el periodo de gracia.',
  },
  grace_period_started: {
    type: 'membership_grace_period_started',
    auditAction: paymentAuditActions.gracePeriodStartedNotice,
    title: 'Membresia en periodo de gracia',
    message: 'Tu membresia se encuentra en periodo de gracia. Actualiza tu metodo de pago para evitar la suspension.',
  },
  dunning_started: {
    type: 'membership_dunning_started',
    auditAction: paymentAuditActions.dunningStartedNotice,
    title: 'Membresia en regularizacion',
    message: 'Tu membresia requiere regularizacion de pago. Tus publicaciones existentes permanecen activas.',
  },
  dunning_retry: {
    type: 'membership_dunning_retry',
    auditAction: paymentAuditActions.dunningRetryNotice,
    title: 'Recordatorio de pago pendiente',
    message: 'Tu membresia tiene un pago pendiente. Regulariza tu cuenta para conservar todos tus beneficios.',
  },
  recovered: {
    type: 'membership_recovered',
    auditAction: paymentAuditActions.recoveredNotice,
    title: 'Pago procesado correctamente',
    message: 'Tu pago fue procesado correctamente. Tu membresia continua activa.',
  },
  suspended: {
    type: 'membership_suspended',
    auditAction: paymentAuditActions.suspendedNotice,
    title: 'Membresia suspendida',
    message: 'Tu membresia fue suspendida por falta de pago. Tus publicaciones existentes permanecen activas, pero no podras crear nuevas publicaciones hasta regularizar tu cuenta.',
  },
  cancelled: {
    type: 'membership_cancelled',
    auditAction: paymentAuditActions.cancelledNotice,
    title: 'Membresia cancelada',
    message: 'Tu membresia fue cancelada. Puedes volver a activar un plan cuando lo necesites.',
  },
};

export async function createMembershipNotice(
  userId: string | Types.ObjectId,
  key: MembershipNoticeKey
) {
  const content = noticeContent[key];
  const actor = String(userId);

  const existing = await Notification.findOne({
    userId: new Types.ObjectId(actor),
    type: content.type,
    message: content.message,
  });

  if (!existing) {
    await Notification.create({
      userId: new Types.ObjectId(actor),
      type: content.type,
      title: content.title,
      message: content.message,
      read: false,
    });
  }

  await Audit.create({
    actor,
    action: content.auditAction,
  });
}
