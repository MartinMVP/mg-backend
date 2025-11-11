import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import { upload } from '../middlewares/upload';
import { Media } from '../../domain/media/media.model';

const r = Router();

/**
 * POST /api/media
 * Subida de imagen (multipart/form-data) campo "file"
 * Respuestas claras para archivo demasiado grande y tipo inválido.
 */
r.post('/media', requireAuth, (req, res, next) => {
  upload.single('file')(req, res, async (err: any) => {
    try {
      if (err?.name === 'MulterError' && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large' });
      }
      if (err) return res.status(400).json({ error: err.message || 'Upload error' });

      const user = (req as any).user;
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) return res.status(400).json({ error: 'No file uploaded' });

      const fileUrl = `/files/${file.filename}`;
      const doc = await Media.create({ owner: user.sub, url: fileUrl, kind: 'image' });
      res.status(201).json(doc);
    } catch (e) {
      next(e);
    }
  });
});

export default r;
