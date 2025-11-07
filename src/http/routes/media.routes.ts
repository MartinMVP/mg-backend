import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import { upload } from '../middlewares/upload';
import { Media } from '../../domain/media/media.model';

const r = Router();

r.post('/media', requireAuth, upload.single('file'), async (req, res) => {
  const user = (req as any).user;

  // Con @types/multer, Request queda augmentado.
  // Aun así, casteamos para mantener TS feliz en builds estrictos.
  const file = (req as unknown as { file?: Express.Multer.File }).file;

  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  const fileUrl = `/files/${file.filename}`;
  const doc = await Media.create({ owner: user.sub, url: fileUrl, kind: 'image' });
  res.status(201).json(doc);
});

export default r;
