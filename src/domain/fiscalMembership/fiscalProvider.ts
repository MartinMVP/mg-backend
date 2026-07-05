import { createHash, randomUUID } from 'crypto';

export type MembershipInvoiceRequest = {
  transactionId: string;
  membershipId: string;
  userId: string;
  amount: number;
  currency: string;
  receiver: {
    rfc: string;
    razonSocial: string;
    regimenFiscal: string;
    codigoPostal: string;
    usoCFDI: string;
    emailFacturacion?: string;
    publicGeneral: boolean;
  };
  metadata?: Record<string, unknown>;
};

export type MembershipInvoiceResult = {
  uuid: string;
  xmlUrl: string;
  pdfUrl: string;
  providerReference: string;
  providerRequestId: string;
  xmlVersion: string;
  pdfVersion: string;
};

export type MembershipCancelResult = {
  cancelledAt: Date;
  providerReference: string;
  providerRequestId: string;
};

export interface FiscalProvider {
  name: string;
  emitInvoice(input: MembershipInvoiceRequest): Promise<MembershipInvoiceResult>;
  cancelInvoice(input: { invoiceUUID: string; reason: string; metadata?: Record<string, unknown> }): Promise<MembershipCancelResult>;
  downloadXML(input: { invoiceUUID: string }): Promise<{ url: string }>;
  downloadPDF(input: { invoiceUUID: string }): Promise<{ url: string }>;
  getInvoiceStatus(input: { invoiceUUID: string }): Promise<{ status: string; message?: string }>;
}

export class FiscalProviderError extends Error {
  constructor(public readonly reason: string, message = reason) {
    super(message);
  }
}

function deterministicUuid(seed: string) {
  const hash = createHash('sha256').update(seed).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16),
    '8' + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join('-');
}

function providerMode(metadata?: Record<string, unknown>) {
  return String(metadata?.providerMode || metadata?.fiscalProviderMode || 'success');
}

export class FacturamaProvider implements FiscalProvider {
  name = 'facturama';

  async emitInvoice(input: MembershipInvoiceRequest): Promise<MembershipInvoiceResult> {
    const mode = providerMode(input.metadata);
    if (mode === 'pac_down') throw new FiscalProviderError('pac_down');
    if (mode === 'timbrado_rejected') throw new FiscalProviderError('timbrado_rejected');
    if (mode === 'sat_error') throw new FiscalProviderError('sat_error');
    if (mode === 'pac_timeout') throw new FiscalProviderError('pac_timeout');
    if (mode === 'xml_unavailable') throw new FiscalProviderError('xml_unavailable');
    if (mode === 'pdf_unavailable') throw new FiscalProviderError('pdf_unavailable');

    const uuid = deterministicUuid(`${input.transactionId}:${input.membershipId}:${input.amount}`);
    return {
      uuid,
      xmlUrl: `facturama://xml/${uuid}`,
      pdfUrl: `facturama://pdf/${uuid}`,
      providerReference: `facturama-${uuid}`,
      providerRequestId: randomUUID(),
      xmlVersion: '4.0',
      pdfVersion: '1.0',
    };
  }

  async cancelInvoice(input: { invoiceUUID: string; reason: string; metadata?: Record<string, unknown> }): Promise<MembershipCancelResult> {
    const mode = providerMode(input.metadata);
    if (mode === 'cancellation_rejected') throw new FiscalProviderError('cancellation_rejected');
    if (mode === 'cancellation_error') throw new FiscalProviderError('cancellation_error');

    return {
      cancelledAt: new Date(),
      providerReference: `facturama-cancel-${input.invoiceUUID}`,
      providerRequestId: randomUUID(),
    };
  }

  async downloadXML(input: { invoiceUUID: string }) {
    return { url: `facturama://xml/${input.invoiceUUID}` };
  }

  async downloadPDF(input: { invoiceUUID: string }) {
    return { url: `facturama://pdf/${input.invoiceUUID}` };
  }

  async getInvoiceStatus(input: { invoiceUUID: string }) {
    return { status: input.invoiceUUID ? 'issued' : 'unknown' };
  }
}

export class FutureProvider extends FacturamaProvider {
  name = 'future';
}

export function getMembershipFiscalProvider(provider = 'facturama'): FiscalProvider {
  if (provider === 'future') return new FutureProvider();
  return new FacturamaProvider();
}
