import multer from 'multer';
import { randomUUID } from 'crypto';
import path from 'path';
import type { Request } from 'express';

const MAX_MB = Number(process.env.UPLOAD_MAX_MB || 5); // default 5 MB

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, 'uploads/'),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const stem = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 60) || 'upload';

    cb(null, `${Date.now()}-${randomUUID()}-${stem}${ext}`);
  },
});

const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

function fileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowed.has(ext)) return cb(new Error('Invalid file type'));
  if (!allowedMimeTypes.has(file.mimetype)) return cb(new Error('Invalid file mimetype'));
  cb(null, true);
}

export const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter,
});
