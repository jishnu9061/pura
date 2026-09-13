import { Router } from 'express';
import { prisma } from '../prisma.js';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import nodemailer from 'nodemailer';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

// Rate limiting for login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: { error: 'Too many login attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Function to get client info for logging
function getClientInfo(req: any) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded ? forwarded.split(',')[0] : req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'Unknown';
  
  return {
    ip: ip || 'Unknown',
    userAgent,
    timestamp: new Date().toISOString(),
  };
}

// Function to send login notification email
async function sendLoginNotification(user: any, clientInfo: any) {
  try {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ADMIN_EMAIL } = process.env as any;
    if (!SMTP_HOST || !SMTP_PORT) return;

    const port = Number(SMTP_PORT) || 587;
    const isSSL = port === 465;
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure: isSSL,
      connectionTimeout: 10000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
      auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
      tls: isSSL ? undefined : {
        ciphers: 'SSLv3',
        rejectUnauthorized: false
      }
    });

    const adminEmail = ADMIN_EMAIL || 'hello@purayidakrishi.com';
    if (adminEmail.includes('example.com')) return;

    const subject = 'Admin Login Alert - Purayida Krishi';
    const text = `Admin login detected:

User: ${user.email}
Time: ${clientInfo.timestamp}
IP Address: ${clientInfo.ip}
Device/Browser: ${clientInfo.userAgent}

If this wasn't you, please secure your account immediately.

Best regards,
Purayida Krishi Security System`;

    const html = `
      <div style="font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111827;max-width:600px">
        <h2 style="color:#dc2626">🔐 Admin Login Alert</h2>
        <p>An admin login was detected on your Purayida Krishi website:</p>
        
        <div style="background:#f9fafb;padding:16px;border-left:4px solid #dc2626;margin:16px 0">
          <p style="margin:0 0 8px;font-weight:600">Login Details:</p>
          <p style="margin:4px 0"><strong>User:</strong> ${user.email}</p>
          <p style="margin:4px 0"><strong>Time:</strong> ${clientInfo.timestamp}</p>
          <p style="margin:4px 0"><strong>IP Address:</strong> ${clientInfo.ip}</p>
          <p style="margin:4px 0"><strong>Device/Browser:</strong> ${clientInfo.userAgent}</p>
        </div>
        
        <div style="background:#fef2f2;padding:16px;border-left:4px solid #f87171;margin:16px 0">
          <p style="margin:0;color:#b91c1c"><strong>⚠️ Security Notice:</strong> If this wasn't you, please secure your account immediately by changing your password.</p>
        </div>
        
        <p style="margin-top:16px">Best regards,<br/>Purayida Krishi Security System</p>
      </div>`;

    const from = SMTP_USER ? `Purayida Krishi Security <${SMTP_USER}>` : 'security@purayidakrishi.com';
    await transporter.sendMail({
      from,
      to: adminEmail,
      subject,
      text,
      html,
      replyTo: 'hello@purayidakrishi.com'
    });

    console.log('[security] Login notification sent to admin');
  } catch (error) {
    console.error('[security] Failed to send login notification:', error);
  }
}

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    const { email, password } = parsed.data;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      console.log(`[security] Failed login attempt for ${email} from ${getClientInfo(req).ip}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Get client information for logging and notification
    const clientInfo = getClientInfo(req);
    
    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ error: 'Missing JWT secret' });
    const token = jwt.sign({ sub: user.id, role: user.role }, secret, { expiresIn: '1d' });

    // Log successful login
    console.log(`[security] Successful admin login: ${user.email} from ${clientInfo.ip} at ${clientInfo.timestamp}`);

    // Send login notification email (non-blocking)
    sendLoginNotification(user, clientInfo).catch(err => 
      console.error('[security] Login notification failed:', err)
    );

    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
