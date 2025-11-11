import multer from 'multer';
import path from 'path';
import type { Request } from 'express';

const MAX_MB = Number(process.env.UPLOAD_MAX_MB || 5); // default 5 MB

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, 'uploads/'),
  filename: (_req, file, cb) =>
    cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`),
});

const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function fileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowed.has(ext)) return cb(new Error('Invalid file type'));
  cb(null, true);
}

export const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter,
});
