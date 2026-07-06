import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import {
  archiveListingConversation,
  closeListingConversation,
  createListingConversation,
  getListingConversationForUser,
  listListingConversationsForUser,
  sendListingConversationMessage,
} from '../../domain/messaging/commercialMessaging.service';

const router = Router();

function handleCommercialMessagingError(res: any, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = (error as any)?.status;
  if (message === 'invalid_object_id') return res.status(400).json({ error: message });
  if (message === 'listingId_required') return res.status(400).json({ error: message });
  if (message === 'listing_not_found') return res.status(404).json({ error: message });
  if (message === 'conversation_not_found') return res.status(404).json({ error: message });
  if (message === 'cannot_message_self') return res.status(400).json({ error: message });
  if (message === 'message_body_required') return res.status(400).json({ error: message });
  if (message === 'forbidden') return res.status(403).json({ error: message });
  if (status) return res.status(status).json({ error: message });
  throw error;
}

router.post('/conversations', requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const result = await createListingConversation({ listingId: req.body?.listingId, buyerId: user.sub });
    res.status(result.created ? 201 : 200).json({ conversation: result.conversation, created: result.created });
  } catch (error) {
    try { return handleCommercialMessagingError(res, error); } catch (nextError) { return next(nextError); }
  }
});

router.get('/conversations', requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    res.json(await listListingConversationsForUser(user.sub, { page: req.query.page, limit: req.query.limit }));
  } catch (error) {
    next(error);
  }
});

router.get('/conversations/:id', requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    res.json(await getListingConversationForUser(String(req.params.id), user.sub, { page: req.query.page, limit: req.query.limit }));
  } catch (error) {
    try { return handleCommercialMessagingError(res, error); } catch (nextError) { return next(nextError); }
  }
});

router.post('/conversations/:id/messages', requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const message = await sendListingConversationMessage({
      conversationId: String(req.params.id),
      senderId: user.sub,
      body: String(req.body?.body || ''),
      metadata: req.body?.metadata,
    });
    res.status(201).json(message);
  } catch (error) {
    try { return handleCommercialMessagingError(res, error); } catch (nextError) { return next(nextError); }
  }
});

router.patch('/conversations/:id/archive', requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    res.json(await archiveListingConversation({ conversationId: String(req.params.id), actorId: user.sub }));
  } catch (error) {
    try { return handleCommercialMessagingError(res, error); } catch (nextError) { return next(nextError); }
  }
});

router.patch('/conversations/:id/close', requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    res.json(await closeListingConversation({ conversationId: String(req.params.id), actorId: user.sub }));
  } catch (error) {
    try { return handleCommercialMessagingError(res, error); } catch (nextError) { return next(nextError); }
  }
});

export default router;
