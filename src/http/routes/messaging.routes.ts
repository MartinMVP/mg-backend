import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import {
  archiveConversation,
  closeConversation,
  getConversationForParticipant,
  getConversationsForUser,
  getOrCreateCommercialConversation,
  listMessagesForParticipant,
  markConversationRead,
  sendMessage,
  sendSystemMessage,
} from '../../domain/messaging/messaging.service';

const router = Router();

function handleMessagingError(res: any, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = (error as any)?.status;

  if (message === 'invalid_object_id') return res.status(400).json({ error: message });
  if (message === 'listing_not_found') return res.status(404).json({ error: message });
  if (message === 'conversation_not_found') return res.status(404).json({ error: message });
  if (message === 'cannot_message_self') return res.status(400).json({ error: message });
  if (message === 'message_body_required') return res.status(400).json({ error: message });
  if (message === 'metadata_invalid') return res.status(400).json({ error: message });
  if (message === 'forbidden') return res.status(403).json({ error: message });
  if (message === 'conversation_daily_limit_reached') {
    return res.status(429).json({
      error: message,
      limit: (error as any).limit,
      plan: (error as any).plan,
    });
  }
  if (status) return res.status(status).json({ error: message });
  throw error;
}

router.post('/conversations', requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const listingId = req.body?.listingId;
    if (!listingId) return res.status(400).json({ error: 'listingId_required' });

    const result = await getOrCreateCommercialConversation({
      listingId: String(listingId),
      buyerId: user.sub,
    });

    res.status(result.created ? 201 : 200).json({
      conversation: result.conversation,
      created: result.created,
    });
  } catch (error) {
    try {
      return handleMessagingError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/conversations', requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const conversations = await getConversationsForUser(user.sub, {
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status as any,
      type: req.query.type as any,
    });
    res.json(conversations);
  } catch (error) {
    next(error);
  }
});

router.get('/conversations/:id', requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const conversation = await getConversationForParticipant(String(req.params.id), user.sub);
    res.json(conversation);
  } catch (error) {
    try {
      return handleMessagingError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.post('/conversations/:id/read', requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const participant = await markConversationRead({ conversationId: String(req.params.id), userId: user.sub });
    res.json(participant);
  } catch (error) {
    try {
      return handleMessagingError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.post('/conversations/:id/messages', requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const isSystem = req.body?.type === 'system';
    const message = isSystem
      ? await sendSystemMessage({
          conversationId: String(req.params.id),
          actorId: user.sub,
          source: req.body?.source || 'system',
          body: String(req.body?.body || ''),
          eventKey: req.body?.eventKey,
          metadata: req.body?.metadata,
        })
      : await sendMessage({
          conversationId: String(req.params.id),
          senderId: user.sub,
          body: String(req.body?.body || ''),
        });

    res.status(201).json(message);
  } catch (error) {
    try {
      return handleMessagingError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/conversations/:id/messages', requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const messages = await listMessagesForParticipant(String(req.params.id), user.sub, {
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json(messages);
  } catch (error) {
    try {
      return handleMessagingError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.post('/conversations/:id/archive', requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const conversation = await archiveConversation({ conversationId: String(req.params.id), actorId: user.sub });
    res.json(conversation);
  } catch (error) {
    try {
      return handleMessagingError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.post('/conversations/:id/close', requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const conversation = await closeConversation({ conversationId: String(req.params.id), actorId: user.sub });
    res.json(conversation);
  } catch (error) {
    try {
      return handleMessagingError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

export default router;
