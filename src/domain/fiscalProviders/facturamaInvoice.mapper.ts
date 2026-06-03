import { ProviderInvoiceRequest } from './providerInvoice.types';
import { FacturamaInvoiceDraftRequest } from './facturamaInvoice.types';

export function mapProviderInvoiceToFacturamaDraft(
  providerInvoiceRequest: ProviderInvoiceRequest
): FacturamaInvoiceDraftRequest {
  return {
    issuer: {
      rfc: providerInvoiceRequest.issuer.rfc,
      name: providerInvoiceRequest.issuer.name,
      fiscalRegime: providerInvoiceRequest.issuer.fiscalRegime,
      postalCode: providerInvoiceRequest.issuer.postalCode,
    },
    receiver: {
      rfc: providerInvoiceRequest.receiver.rfc,
      name: providerInvoiceRequest.receiver.name,
      fiscalRegime: providerInvoiceRequest.receiver.fiscalRegime,
      postalCode: providerInvoiceRequest.receiver.postalCode,
      cfdiUse: providerInvoiceRequest.receiver.invoiceUse,
    },
    concepts: providerInvoiceRequest.concepts.map((concept) => ({
      productCode: concept.productServiceKey,
      unitCode: concept.unitKey,
      description: concept.description,
      quantity: concept.quantity,
      unitPrice: concept.unitPrice,
      amount: concept.amount,
      taxObject: concept.taxObject,
    })),
    totals: {
      subtotal: providerInvoiceRequest.totals.subtotal,
      taxes: providerInvoiceRequest.totals.taxes,
      total: providerInvoiceRequest.totals.total,
      currency: providerInvoiceRequest.totals.currency,
    },
    expeditionPlace: providerInvoiceRequest.issuer.postalCode,
    metadata: {
      source: 'provider_invoice_request',
      compatibility: 'facturama_draft_preview_only',
      transactionId: providerInvoiceRequest.transactionId,
      invoiceRecordId: providerInvoiceRequest.invoiceRecordId,
      providerOperationId: providerInvoiceRequest.metadata.providerOperationId,
      idempotencyKey: providerInvoiceRequest.metadata.idempotencyKey,
    },
  };
}
