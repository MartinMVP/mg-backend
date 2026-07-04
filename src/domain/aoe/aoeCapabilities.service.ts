export const aoeCapabilities = {
  evidence: true,
  classification: true,
  decisionProposal: true,
  escalation: true,
  execution: false,
} as const;

export function getAOECapabilities() {
  return aoeCapabilities;
}
