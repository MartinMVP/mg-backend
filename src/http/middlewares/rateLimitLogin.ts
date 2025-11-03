import { Request, Response, NextFunction } from 'express';
import { RateLimiterMemory } from 'rate-limiter-flexible';


const limiter = new RateLimiterMemory({ points: 5, duration: 60, blockDuration: 300 }); // 5 intentos/min, bloquea 5 min


export async function rateLimitLogin(req: Request, res: Response, next: NextFunction) {
const email = (req.body?.email || '').toLowerCase();
const key = `${req.ip || 'ip'}:${email}`;
try {
await limiter.consume(key);
return next();
} catch {
return res.status(429).json({ error: 'Too Many Attempts. Try later.' });
}
}