import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { FiscalProvider } from '../fiscalProviders/fiscalProvider.interface';
import { getFiscalProviderConfig } from '../fiscalProviders/fiscalProvider.config';
import { resolveFiscalProvider } from '../fiscalProviders/fiscalProvider.registry';
import { InvoiceQueue } from '../invoiceQueue/invoiceQueue.model';
import { InvoiceRecord } from '../invoiceRecords/invoiceRecord.model';

type ProcessInvoiceQueueOptions = {
  invoiceQueueId?: string | Types.ObjectId;
  actor?: string;
  provider?: FiscalProvider;
};

export const MAX_INVOICE_PROCESSING_ATTEMPTS = 3;

type InvoiceAuditRefs = {
  transactionId?: Types.ObjectId;
  invoiceRecordId?: Types.ObjectId;
  invoiceQueueId?: Types.ObjectId;
};

async function audit(actor: string, action: string, refs: InvoiceAuditRefs = {}) {
  await Audit.create({ actor, action, ...refs });
}

export async function processInvoiceQueue(options: ProcessInvoiceQueueOptions = {}) {
  const actor = options.actor || 'system';
  const resolvedProvider = options.provider
    ? { provider: options.provider, config: getFiscalProviderConfig() }
    : resolveFiscalProvider();
  const provider = resolvedProvider.provider;
  const providerConfig = resolvedProvider.config;
  const queueFilter: Record<string, unknown> = { status: 'queued' };

  if (options.invoiceQueueId) {
    if (!Types.ObjectId.isValid(String(options.invoiceQueueId))) {
      return { ok: false, status: 400, error: 'Invalid invoice queue id' };
    }
    queueFilter._id = new Types.ObjectId(String(options.invoiceQueueId));
  }

  const queue = await InvoiceQueue.findOneAndUpdate(
    queueFilter,
    { $set: { status: 'processing' } },
    { new: true, sort: { queuedAt: 1 }, runValidators: true }
  );

  if (!queue) {
    if (options.invoiceQueueId) {
      const exists = await InvoiceQueue.exists({ _id: options.invoiceQueueId });
      if (!exists) {
        return { ok: false, status: 404, error: 'Not found' };
      }
    }

    return {
      ok: false,
      status: options.invoiceQueueId ? 409 : 404,
      error: options.invoiceQueueId ? 'Invoice queue is not queued' : 'No queued invoice operations',
    };
  }

  let record: any = null;
  try {
    await audit(actor, 'INVOICE_QUEUE_CLAIMED', {
      transactionId: queue.transactionId,
      invoiceQueueId: queue._id,
    });

    record = await InvoiceRecord.findOneAndUpdate(
      { invoiceQueueId: queue._id },
      {
        $setOnInsert: {
          transactionId: queue.transactionId,
          invoiceDraftId: queue.invoiceDraftId,
          invoiceQueueId: queue._id,
        },
        $set: {
          status: 'processing',
        },
        $unset: { lastError: '' },
        $inc: { attempts: 1 },
      },
      { new: true, upsert: true, runValidators: true }
    );

    await audit(actor, 'INVOICE_PROCESSING_STARTED', {
      transactionId: queue.transactionId,
      invoiceRecordId: record._id,
      invoiceQueueId: queue._id,
    });

    const providerInput = {
      transactionId: queue.transactionId,
      invoiceDraftId: queue.invoiceDraftId,
      invoiceQueueId: queue._id,
    };
    const validation = await provider.validateInvoiceInput(providerInput);
    if (!validation.ok) {
      throw new Error(validation.message);
    }

    const issueResult = await provider.issueInvoice(providerInput);
    if (!issueResult.ok) {
      throw new Error(issueResult.providerMessage);
    }

    const now = new Date();
    const [completedQueue, completedRecord] = await Promise.all([
      InvoiceQueue.findByIdAndUpdate(
        queue._id,
        { $set: { status: 'completed', processedAt: now } },
        { new: true, runValidators: true }
      ),
      InvoiceRecord.findByIdAndUpdate(
        record._id,
        {
          $set: {
            status: 'completed',
            processedAt: now,
            provider: provider.name,
            providerEnvironment: providerConfig.environment,
            providerReference: issueResult.providerReference,
            providerRequestId: issueResult.providerRequestId,
            providerName: provider.name,
            providerStatus: issueResult.providerStatus,
            providerMessage: issueResult.providerMessage,
            simulatedExternalId: issueResult.simulatedExternalId,
          },
          $unset: { lastError: '' },
        },
        { new: true, runValidators: true }
      ),
    ]);

    await audit(actor, 'INVOICE_PROCESSING_COMPLETED', {
      transactionId: queue.transactionId,
      invoiceRecordId: record._id,
      invoiceQueueId: queue._id,
    });

    return {
      ok: true,
      invoiceQueue: completedQueue,
      invoiceRecord: completedRecord,
    };
  } catch (error: any) {
    const message = error?.message || 'Invoice processing failed';
    const failedRecordUpdate: any = {
      $setOnInsert: {
        transactionId: queue.transactionId,
        invoiceDraftId: queue.invoiceDraftId,
        invoiceQueueId: queue._id,
      },
      $set: {
        status: 'failed',
        lastError: message,
        provider: provider.name,
        providerEnvironment: providerConfig.environment,
        providerName: provider.name,
        providerStatus: 'failed',
        providerMessage: message,
      },
    };

    if (!record) failedRecordUpdate.$inc = { attempts: 1 };

    const failedRecord = await InvoiceRecord.findOneAndUpdate(
      { invoiceQueueId: queue._id },
      failedRecordUpdate,
      { new: true, upsert: true, runValidators: true }
    );
    const maxAttemptsReached = (failedRecord?.attempts || 0) >= MAX_INVOICE_PROCESSING_ATTEMPTS;
    const resetQueue = await InvoiceQueue.findByIdAndUpdate(
      queue._id,
      { $set: { status: maxAttemptsReached ? 'cancelled' : 'queued' } },
      { new: true, runValidators: true }
    );

    await audit(actor, 'INVOICE_PROCESSING_FAILED', {
      transactionId: queue.transactionId,
      invoiceRecordId: failedRecord._id,
      invoiceQueueId: queue._id,
    });
    if (maxAttemptsReached) {
      await audit(actor, 'INVOICE_PROCESSING_MAX_ATTEMPTS_REACHED', {
        transactionId: queue.transactionId,
        invoiceRecordId: failedRecord._id,
        invoiceQueueId: queue._id,
      });
    }

    return {
      ok: false,
      status: 500,
      error: message,
      invoiceQueue: resetQueue,
      invoiceRecord: failedRecord,
    };
  }
}
