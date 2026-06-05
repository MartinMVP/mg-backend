import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { Notification, NotificationType } from '../notifications/notification.model';
import { membershipAuditActions } from './membership.audit';

type MembershipChangeNoticeKey =
  | 'upgrade_requested'
  | 'downgrade_scheduled'
  | 'downgrade_completed'
  | 'cancellation_scheduled'
  | 'cancellation_completed'
  | 'reactivation';

const noticeContent: Record<MembershipChangeNoticeKey, {
  type: NotificationType;
  auditAction: string;
  title: string;
  message: string;
}> = {
  upgrade_requested: {
    type: 'membership_upgrade_requested',
    auditAction: membershipAuditActions.upgradeRequestedNotice,
    title: 'Cambio de plan solicitado',
    message: 'Recibimos tu solicitud de cambio de plan. Para activar beneficios de un plan pagado se requiere pago confirmado.',
  },
  downgrade_scheduled: {
    type: 'membership_downgrade_scheduled',
    auditAction: membershipAuditActions.downgradeScheduledNotice,
    title: 'Cambio de plan programado',
    message: 'Tu cambio a un plan menor quedo programado para el final del periodo actual.',
  },
  downgrade_completed: {
    type: 'membership_downgrade_completed',
    auditAction: membershipAuditActions.downgradeCompletedNotice,
    title: 'Cambio de plan aplicado',
    message: 'El cambio de plan programado fue aplicado. Tus publicaciones existentes permanecen activas.',
  },
  cancellation_scheduled: {
    type: 'membership_cancellation_scheduled',
    auditAction: membershipAuditActions.cancellationScheduledNotice,
    title: 'Cancelacion programada',
    message: 'Tu membresia quedo programada para cancelarse al final del periodo actual.',
  },
  cancellation_completed: {
    type: 'membership_cancellation_completed',
    auditAction: membershipAuditActions.cancellationCompletedNotice,
    title: 'Cancelacion aplicada',
    message: 'La cancelacion de tu membresia fue aplicada. Tus publicaciones existentes permanecen activas.',
  },
  reactivation: {
    type: 'membership_reactivation',
    auditAction: membershipAuditActions.reactivationNotice,
    title: 'Membresia reactivada',
    message: 'Tu membresia continua activa y la cancelacion programada fue retirada.',
  },
};

export async function createMembershipChangeNotice(userId: string | Types.ObjectId, key: MembershipChangeNoticeKey) {
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

  await Audit.create({ actor, action: content.auditAction });
}
