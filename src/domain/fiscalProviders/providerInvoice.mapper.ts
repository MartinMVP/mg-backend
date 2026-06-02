import { CfdiRequest } from '../cfdi/cfdi.types';
import { ProviderInvoiceRequest } from './providerInvoice.types';

export function mapCfdiToProviderInvoiceRequest(cfdiRequest: CfdiRequest): ProviderInvoiceRequest {
  return {
    transactionId: cfdiRequest.transactionId,
    invoiceRecordId: cfdiRequest.invoiceRecordId,
    issuer: {
      rfc: cfdiRequest.issuer.rfc,
      name: cfdiRequest.issuer.name,
      fiscalRegime: cfdiRequest.issuer.regimenFiscal,
      postalCode: cfdiRequest.issuer.postalCode,
    },
    receiver: {
      rfc: cfdiRequest.receiver.rfc,
      name: cfdiRequest.receiver.name,
      fiscalRegime: cfdiRequest.receiver.regimenFiscal,
      postalCode: cfdiRequest.receiver.postalCode,
      invoiceUse: cfdiRequest.receiver.usoCFDI,
    },
    concepts: cfdiRequest.concepts.map((concept) => ({
      description: concept.description,
      productServiceKey: concept.productServiceKey,
      quantity: concept.quantity,
      unitKey: concept.unitKey,
      unitPrice: concept.unitPrice,
      amount: concept.amount,
      taxObject: concept.taxObject,
    })),
    totals: {
      subtotal: cfdiRequest.totals.subtotal,
      taxes: cfdiRequest.totals.taxes,
      total: cfdiRequest.totals.total,
      currency: cfdiRequest.totals.currency,
    },
    metadata: {
      source: 'internal_cfdi_request',
      transactionId: cfdiRequest.transactionId,
      invoiceRecordId: cfdiRequest.invoiceRecordId,
    },
  };
}
