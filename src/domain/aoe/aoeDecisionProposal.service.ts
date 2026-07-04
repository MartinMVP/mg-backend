import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { getConfigValue } from '../platformConfiguration/platformConfiguration.service';
import { AOECase } from './aoeCase.model';
import { classifyAOECase } from './aoeClassification.service';
import {
  AOEDecisionProposal,
  AOEDecisionProposalStatus,
  AOEDecisionProposalType,
} from './aoeDecisionProposal.model';
import { listAOEEvidenceForCase, toObjectId } from './aoeEvidence.service';
import { shouldEscalateToAdmin } from './aoeEscalation.service';

export const aoeDecisionProposalAuditActions = {
  created: 'AOE_DECISION_PROPOSAL_CREATED',
  viewed: 'AOE_DECISION_PROPOSAL_VIEWED',
  escalated: 'AOE_DECISION_PROPOSAL_ESCALATED',
  closed: 'AOE_DECISION_PROPOSAL_CLOSED',
} as const;

function reject(status: number, message: string): never {
  const error = new Error(message);
  (error as any).status = status;
  throw error;
}

async function audit(actor: string, action: string, payload: Record<string, unknown>) {
  await Audit.create({ actor, action, payload });
}

function averageConfidence(values: number[], fallback: number) {
  if (values.length === 0) return fallback;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function proposalForClassification(classification: string): {
  proposalType: AOEDecisionProposalType;
  explanation: string;
  proposedAction: string;
} {
  if (classification === 'appeal_request') {
    return {
      proposalType: 'suggest_appeal_approval',
      explanation: 'AOE detecto una apelacion que requiere revision administrativa.',
      proposedAction: 'Revisar evidencia de apelacion y resolver manualmente.',
    };
  }
  if (classification === 'possible_fraud' || classification === 'high_value_conflict') {
    return {
      proposalType: 'escalate',
      explanation: 'AOE detecto una senal de riesgo que debe escalarse a administracion.',
      proposedAction: 'Escalar caso para analisis administrativo.',
    };
  }
  if (classification === 'repeat_default') {
    return {
      proposalType: 'suggest_sanction',
      explanation: 'AOE detecto reincidencia operativa en incumplimientos confirmados.',
      proposedAction: 'Evaluar aplicacion explicita de sancion desde el flujo administrativo.',
    };
  }
  if (classification === 'seller_abandonment' || classification === 'buyer_abandonment' || classification === 'simple_default') {
    return {
      proposalType: 'suggest_sanction',
      explanation: 'AOE detecto incumplimiento confirmado y propone revision de sancion.',
      proposedAction: 'Revisar recomendacion y aplicar sancion manualmente si corresponde.',
    };
  }
  return {
    proposalType: 'need_more_evidence',
    explanation: 'AOE requiere mas evidencia antes de proponer una decision.',
    proposedAction: 'Agregar evidencia y mantener seguimiento administrativo.',
  };
}

export async function buildAOEDecisionProposal(aoeCaseId: string | Types.ObjectId) {
  const caseObjectId = toObjectId(aoeCaseId);
  const aoeCase = await AOECase.findById(caseObjectId);
  if (!aoeCase) reject(404, 'aoe_case_not_found');

  const [evidence, configuredMinimumConfidence] = await Promise.all([
    listAOEEvidenceForCase(caseObjectId),
    getConfigValue('aoe.minimumConfidence', 'sandbox', 70),
  ]);
  const minimumConfidence = Number(configuredMinimumConfidence) || 70;
  const classification = classifyAOECase(aoeCase, evidence);
  const shouldEscalate = shouldEscalateToAdmin({
    classification,
    priority: aoeCase.priority,
    evidence,
  });
  const confidence = Math.max(minimumConfidence, averageConfidence(evidence.map((item) => item.confidence), minimumConfidence));
  const baseProposal = proposalForClassification(classification);
  const proposalType = shouldEscalate ? 'escalate' : baseProposal.proposalType;
  const confidenceReason = [
    `classification:${classification}`,
    `evidence_count:${evidence.length}`,
    `priority:${aoeCase.priority}`,
  ];

  const proposal = await AOEDecisionProposal.create({
    aoeCaseId: caseObjectId,
    proposalType,
    confidence,
    confidenceReason,
    explanation: baseProposal.explanation,
    proposedAction: baseProposal.proposedAction,
    learningFeedback: 'unresolved',
    status: 'generated',
  });
  aoeCase.status = shouldEscalate ? 'escalated' : 'proposal_generated';
  await aoeCase.save();
  await audit('system', aoeDecisionProposalAuditActions.created, {
    aoeCaseId: String(caseObjectId),
    aoeDecisionProposalId: String(proposal._id),
    classification,
  });
  return proposal;
}

export async function listAOEDecisionProposalsForCase(aoeCaseId: string | Types.ObjectId) {
  return AOEDecisionProposal.find({ aoeCaseId: toObjectId(aoeCaseId) }).sort({ createdAt: -1 }).lean();
}

export async function setAOEDecisionProposalStatus(input: {
  proposalId: string | Types.ObjectId;
  actorId: string | Types.ObjectId;
  status: Exclude<AOEDecisionProposalStatus, 'generated'>;
}) {
  const proposalId = toObjectId(input.proposalId);
  const proposal = await AOEDecisionProposal.findByIdAndUpdate(
    proposalId,
    { $set: { status: input.status } },
    { new: true, runValidators: true }
  );
  if (!proposal) reject(404, 'aoe_decision_proposal_not_found');
  const actionByStatus = {
    viewed: aoeDecisionProposalAuditActions.viewed,
    escalated: aoeDecisionProposalAuditActions.escalated,
    closed: aoeDecisionProposalAuditActions.closed,
  };
  await audit(String(input.actorId), actionByStatus[input.status], {
    aoeDecisionProposalId: String(proposal._id),
    aoeCaseId: String(proposal.aoeCaseId),
  });
  return proposal;
}
