import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import publicRouter from './routes/public.js';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import helmet from 'helmet';
import morgan from 'morgan';
import fs from 'fs';
const app = express();
// Behind a reverse proxy (e.g., Nginx). Trust exactly 1 hop for correct client IPs
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT || 4000);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
const ORIGINS = FRONTEND_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: ORIGINS.length <= 1 ? ORIGINS[0] : ORIGINS }));
app.use(helmet());
app.use(morgan('tiny'));
app.use(express.json());
// Static serving for uploads (ensure folder exists)
{
    const envDir = process.env.UPLOADS_DIR;
    const uploadsDir = envDir && envDir.trim() ? envDir : path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }
    app.use('/uploads', express.static(uploadsDir));
}
app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'purayida-custom-cms', version: '0.1.0' });
});
// Mount public API routes
app.use('/api', publicRouter);
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.listen(PORT, () => {
    console.log(`Custom CMS server running on http://localhost:${PORT}`);
});
