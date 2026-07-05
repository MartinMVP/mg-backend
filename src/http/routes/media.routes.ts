import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import { upload } from '../middlewares/upload';
import { Media } from '../../domain/media/media.model';
import { MediaReference } from '../../domain/media/mediaReference.model';
import { Audit } from '../../domain/audit/audit.model';

const r = Router();

function mediaKind(file: Express.Multer.File) {
  if (file.mimetype.startsWith('image/')) return 'image';
  if (file.mimetype.startsWith('video/')) return 'video';
  return 'document';
}

async function createMediaRecord(userId: string, file: Express.Multer.File) {
  const fileUrl = `/files/${file.filename}`;
  const kind = mediaKind(file);
  const doc = await Media.create({ owner: userId, url: fileUrl, kind, originalName: file.originalname, mimeType: file.mimetype });
  const reference = await MediaReference.findOneAndUpdate(
    { mediaId: doc._id, ownerId: userId },
    { $setOnInsert: { mediaId: doc._id, ownerId: userId, type: kind } },
    { upsert: true, new: true, runValidators: true }
  );
  await Audit.create({ actor: userId, action: 'MEDIA_UPLOADED', entity: 'Media', entityId: doc._id, payload: { kind, mediaReferenceId: reference._id } } as any);
  return { doc, reference };
}

function uploadHandler(req: any, res: any, next: any) {
  upload.single('file')(req, res, async (err: any) => {
    try {
      if (err?.name === 'MulterError' && err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large' });
      if (err) return res.status(400).json({ error: err.message || 'Upload error' });
      const user = req.user;
      const file = req.file as Express.Multer.File | undefined;
      if (!file) return res.status(400).json({ error: 'No file uploaded' });
      const { doc, reference } = await createMediaRecord(user.sub, file);
      res.status(201).json({ ...doc.toObject(), mediaReference: reference });
    } catch (e) {
      next(e);
    }
  });
}

/**
 * POST /api/media
 * Subida de imagen (multipart/form-data) campo "file"
 * Respuestas claras para archivo demasiado grande y tipo inválido.
 */
r.post('/media', requireAuth, uploadHandler);
r.post('/media/upload', requireAuth, uploadHandler);

export default r;


