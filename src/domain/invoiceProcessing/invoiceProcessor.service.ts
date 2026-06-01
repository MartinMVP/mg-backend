import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { InvoiceQueue } from '../invoiceQueue/invoiceQueue.model';
import { InvoiceRecord } from '../invoiceRecords/invoiceRecord.model';

type ProcessInvoiceQueueOptions = {
  invoiceQueueId?: string | Types.ObjectId;
  actor?: string;
};

async function audit(actor: string, action: string) {
  await Audit.create({ actor, action });
}

export async function processInvoiceQueue(options: ProcessInvoiceQueueOptions = {}) {
  const actor = options.actor || 'system';
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

  await audit(actor, 'INVOICE_QUEUE_CLAIMED');

  const record = await InvoiceRecord.findOneAndUpdate(
    { invoiceQueueId: queue._id },
    {
      $setOnInsert: {
        transactionId: queue.transactionId,
        invoiceDraftId: queue.invoiceDraftId,
        invoiceQueueId: queue._id,
      },
      $set: {
        status: 'processing',
        lastError: undefined,
      },
      $inc: { attempts: 1 },
    },
    { new: true, upsert: true, runValidators: true }
  );

  await audit(actor, 'INVOICE_PROCESSING_STARTED');

  try {
    const now = new Date();
    const [completedQueue, completedRecord] = await Promise.all([
      InvoiceQueue.findByIdAndUpdate(
        queue._id,
        { $set: { status: 'completed', processedAt: now } },
        { new: true, runValidators: true }
      ),
      InvoiceRecord.findByIdAndUpdate(
        record._id,
        { $set: { status: 'completed', processedAt: now }, $unset: { lastError: '' } },
        { new: true, runValidators: true }
      ),
    ]);

    await audit(actor, 'INVOICE_PROCESSING_COMPLETED');

    return {
      ok: true,
      invoiceQueue: completedQueue,
      invoiceRecord: completedRecord,
    };
  } catch (error: any) {
    const message = error?.message || 'Invoice processing failed';

    const failedRecord = await InvoiceRecord.findByIdAndUpdate(
      record._id,
      { $set: { status: 'failed', lastError: message } },
      { new: true, runValidators: true }
    );
    const resetQueue = await InvoiceQueue.findByIdAndUpdate(
      queue._id,
      { $set: { status: 'queued' } },
      { new: true, runValidators: true }
    );

    await audit(actor, 'INVOICE_PROCESSING_FAILED');

    return {
      ok: false,
      status: 500,
      error: message,
      invoiceQueue: resetQueue,
      invoiceRecord: failedRecord,
    };
  }
}
