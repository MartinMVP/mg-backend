import { randomUUID } from 'crypto';
import { IFiscalOperation } from './fiscalOperation.model';

export type FiscalProviderEmitResult = {
  ok: boolean;
  providerReference?: string;
  uuid?: string;
  xmlLocation?: string;
  pdfLocation?: string;
  message: string;
  temporary?: boolean;
  definitive?: boolean;
};

export type FiscalProviderCancelResult = {
  ok: boolean;
  providerReference?: string;
  message: string;
  temporary?: boolean;
  definitive?: boolean;
};

export type FiscalProviderStatusResult = {
  ok: boolean;
  providerStatus: string;
  message: string;
};

export interface FiscalPlatformProvider {
  name: string;
  emitInvoice(operation: IFiscalOperation, options?: { recovery?: boolean }): Promise<FiscalProviderEmitResult>;
  cancelInvoice(operation: IFiscalOperation): Promise<FiscalProviderCancelResult>;
  downloadXML(operation: IFiscalOperation): Promise<string>;
  downloadPDF(operation: IFiscalOperation): Promise<string>;
  getInvoiceStatus(operation: IFiscalOperation): Promise<FiscalProviderStatusResult>;
}

export class MockFiscalPlatformProvider implements FiscalPlatformProvider {
  name = 'mock';

  async emitInvoice(operation: IFiscalOperation, options: { recovery?: boolean } = {}) {
    const metadata = operation.metadata || {};
    if (metadata.forceProviderReject) {
      return { ok: false, message: 'fiscal_data_rejected', definitive: true };
    }
    if (metadata.forceTemporaryError && !options.recovery) {
      return { ok: false, message: 'provider_timeout', temporary: true };
    }

    const uuid = `uuid-${randomUUID()}`;
    const providerReference = `fiscal-${String((operation as any)._id)}`;
    return {
      ok: true,
      providerReference,
      uuid,
      xmlLocation: `fiscal://${providerReference}.xml`,
      pdfLocation: `fiscal://${providerReference}.pdf`,
      message: 'invoice_stamped',
    };
  }

  async cancelInvoice(operation: IFiscalOperation) {
    if (operation.metadata?.forceCancelReject) {
      return { ok: false, message: 'cancellation_rejected', definitive: true };
    }
    return {
      ok: true,
      providerReference: operation.providerReference,
      message: 'invoice_cancelled',
    };
  }

  async downloadXML(operation: IFiscalOperation) {
    return operation.xmlLocation || `fiscal://${operation.providerReference || (operation as any)._id}.xml`;
  }

  async downloadPDF(operation: IFiscalOperation) {
    return operation.pdfLocation || `fiscal://${operation.providerReference || (operation as any)._id}.pdf`;
  }

  async getInvoiceStatus(operation: IFiscalOperation) {
    return {
      ok: true,
      providerStatus: operation.invoiceStatus,
      message: 'status_synchronized',
    };
  }
}

export class FacturamaPlatformProvider extends MockFiscalPlatformProvider {
  name = 'facturama';
}

export class FuturePlatformProvider extends MockFiscalPlatformProvider {
  name = 'future';
}

export function resolveFiscalPlatformProvider(name = 'mock'): FiscalPlatformProvider {
  if (name === 'facturama') return new FacturamaPlatformProvider();
  if (name === 'future') return new FuturePlatformProvider();
  return new MockFiscalPlatformProvider();
}
