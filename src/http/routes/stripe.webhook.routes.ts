import express, { Router } from 'express';
import { handleStripeWebhook } from '../../domain/payments/stripeWebhook.service';

const router = Router();

router.post('/payments/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  const signature = req.header('stripe-signature') || undefined;
  const result = await handleStripeWebhook(rawBody, signature);

  if (!result.ok && !result.eventId) {
    return res.status(400).json(result);
  }

  res.status(200).json(result);
});

export default router;
