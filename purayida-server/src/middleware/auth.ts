import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export type JwtPayload = {
  sub: number;
  role: 'ADMIN' | 'EDITOR';
};

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ error: 'Missing JWT secret' });
    const decodedRaw = jwt.verify(token, secret);
    if (typeof decodedRaw !== 'object' || !decodedRaw) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const decoded = decodedRaw as unknown as JwtPayload;
    (req as any).user = decoded;
    next();
  } catch (_e) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

export function requireRole(role: 'ADMIN' | 'EDITOR') {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as JwtPayload | undefined;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (role === 'EDITOR') {
      // ADMIN has access as well
      if (user.role === 'ADMIN' || user.role === 'EDITOR') return next();
    }
    if (role === 'ADMIN' && user.role === 'ADMIN') return next();
    return res.status(403).json({ error: 'Forbidden' });
  };
}
