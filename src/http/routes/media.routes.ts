import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import { upload } from '../middlewares/upload';
import { Media } from '../../domain/media/media.model';

const r = Router();

// Subir imagen
r.post('/media', requireAuth, upload.single('file'), async (req, res) => {
  const user = (req as any).user;
  const fileUrl = `/files/${req.file?.filename}`;
  const doc = await Media.create({ owner: user.sub, url: fileUrl, kind: 'image' });
  res.status(201).json(doc);
});

export default r;
