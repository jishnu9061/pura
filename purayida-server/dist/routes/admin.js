import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { prisma } from '../prisma.js';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import nodemailer from 'nodemailer';
import bcrypt from 'bcryptjs';
const router = Router();
router.use(requireAuth);
router.get('/me', (req, res) => {
    const user = req.user;
    res.json({ user });
});
// ===== Change Password =====
const changePasswordSchema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(128)
        .refine((password) => /[A-Z]/.test(password), { message: 'Password must contain at least one uppercase letter' })
        .refine((password) => /[a-z]/.test(password), { message: 'Password must contain at least one lowercase letter' })
        .refine((password) => /[0-9]/.test(password), { message: 'Password must contain at least one number' })
        .refine((password) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\?]/.test(password), { message: 'Password must contain at least one special character' }),
});
router.post('/change-password', async (req, res) => {
    try {
        const user = req.user;
        const parsed = changePasswordSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Invalid password requirements',
                details: parsed.error.issues.map(issue => issue.message)
            });
        }
        const { currentPassword, newPassword } = parsed.data;
        // Get current user from database
        const currentUser = await prisma.user.findUnique({ where: { id: user.id } });
        if (!currentUser) {
            return res.status(404).json({ error: 'User not found' });
        }
        // Verify current password
        const isCurrentPasswordValid = await bcrypt.compare(currentPassword, currentUser.password);
        if (!isCurrentPasswordValid) {
            console.log(`[security] Failed password change attempt for ${currentUser.email} - invalid current password`);
            return res.status(401).json({ error: 'Current password is incorrect' });
        }
        // Hash new password
        const hashedNewPassword = await bcrypt.hash(newPassword, 12);
        // Update password in database
        await prisma.user.update({
            where: { id: user.id },
            data: { password: hashedNewPassword }
        });
        // Log successful password change
        console.log(`[security] Password changed successfully for ${currentUser.email}`);
        // Send notification email about password change
        (async () => {
            try {
                const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ADMIN_EMAIL } = process.env;
                if (!SMTP_HOST || !SMTP_PORT)
                    return;
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
                if (adminEmail.includes('example.com'))
                    return;
                const forwarded = req.headers['x-forwarded-for'];
                const ip = forwarded ? (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0]) : req.connection.remoteAddress;
                const userAgent = req.headers['user-agent'] || 'Unknown';
                const subject = 'Password Changed - Purayida Krishi Admin';
                const text = `Your admin password has been changed successfully.

User: ${currentUser.email}
Time: ${new Date().toISOString()}
IP Address: ${ip || 'Unknown'}
Device/Browser: ${userAgent}

If you did not make this change, please contact support immediately.

Best regards,
Purayida Krishi Security System`;
                const html = `
          <div style="font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111827;max-width:600px">
            <h2 style="color:#059669">🔐 Password Changed Successfully</h2>
            <p>Your admin password has been changed successfully.</p>
            
            <div style="background:#f0fdf4;padding:16px;border-left:4px solid #059669;margin:16px 0">
              <p style="margin:0 0 8px;font-weight:600">Change Details:</p>
              <p style="margin:4px 0"><strong>User:</strong> ${currentUser.email}</p>
              <p style="margin:4px 0"><strong>Time:</strong> ${new Date().toISOString()}</p>
              <p style="margin:4px 0"><strong>IP Address:</strong> ${ip || 'Unknown'}</p>
              <p style="margin:4px 0"><strong>Device/Browser:</strong> ${userAgent}</p>
            </div>
            
            <div style="background:#fef2f2;padding:16px;border-left:4px solid #f87171;margin:16px 0">
              <p style="margin:0;color:#b91c1c"><strong>⚠️ Security Notice:</strong> If you did not make this change, please contact support immediately.</p>
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
                console.log('[security] Password change notification sent');
            }
            catch (error) {
                console.error('[security] Failed to send password change notification:', error);
            }
        })();
        res.json({ message: 'Password changed successfully' });
    }
    catch (err) {
        console.error('Password change error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ===== Blog Post Comments (EDITOR+) =====
router.get('/post-comments', requireRole('EDITOR'), async (_req, res) => {
    try {
        const comments = await prisma.postComment.findMany({
            orderBy: { createdAt: 'desc' },
            take: 100,
            include: { post: { include: { translations: { take: 1 } } } },
        });
        const items = comments.map((c) => ({
            id: c.id,
            postId: c.postId,
            postTitle: c.post?.translations?.[0]?.title || `Post #${c.postId}`,
            name: c.name,
            content: c.content,
            approved: c.approved,
            createdAt: c.createdAt,
        }));
        res.json(items);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch post comments' });
    }
});
router.delete('/orders/:id', requireRole('EDITOR'), async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id))
            return res.status(400).json({ error: 'Invalid id' });
        try {
            await prisma.orderItem.deleteMany({ where: { orderId: id } });
        }
        catch (_) { }
        await prisma.order.delete({ where: { id } });
        res.status(204).send();
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete order' });
    }
});
// Confirm order and notify customer via email from books@purayidakrishi.com
router.patch('/orders/:id/confirm', requireRole('EDITOR'), async (req, res) => {
    try {
        const { id } = req.params;
        const order = await prisma.order.update({ where: { id: Number(id) }, data: { status: 'CONFIRMED' }, include: { items: { include: { book: { include: { translations: { where: { locale: 'en' } } } } } } } });
        try {
            const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
            if (SMTP_HOST && SMTP_PORT && order.email) {
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
                const itemsText = (order.items || []).map((it) => `${it.book?.translations?.[0]?.name || `#${it.bookId}`} x ${it.quantity}`).join('\n');
                const itemsHtml = (order.items || []).map((it) => `
          <tr>
            <td style="padding:8px;border:1px solid #ddd;">${it.book?.translations?.[0]?.name || `#${it.bookId}`}</td>
            <td style="padding:8px;border:1px solid #ddd;">${it.quantity}</td>
          </tr>
        `).join('');
                const text = `Dear ${order.name},\n\nYour order #${order.id} has been confirmed.\n\nItems:\n${itemsText}\n\nTotal: ${order.total || ''}\n\nThank you for shopping with Purayida Krishi!`;
                const html = `
          <div style="font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111827;max-width:600px">
            <h2 style="color:#2d5016">Order Confirmed</h2>
            <p>Dear ${order.name},</p>
            <p>Your order <strong>#${order.id}</strong> has been confirmed.</p>
            <div style="background:#f9fafb;padding:16px;border-left:4px solid #2d5016;margin:16px 0">
              <p style="margin:4px 0">Total: <strong>${order.total || 'N/A'}</strong></p>
            </div>
            <p style="font-weight:600">Items:</p>
            <table style="width:100%;border-collapse:collapse;margin:8px 0">
              <tr style="background:#f3f4f6"><th style="padding:8px;border:1px solid #ddd;text-align:left">Book</th><th style="padding:8px;border:1px solid #ddd;text-align:left">Quantity</th></tr>
              ${itemsHtml}
            </table>
            <p style="margin-top:16px">Best regards,<br/>Purayida Krishi Team</p>
          </div>`;
                await transporter.sendMail({
                    from: 'Purayida Krishi <books@purayidakrishi.com>',
                    to: order.email,
                    subject: `Order #${order.id} confirmed`,
                    text,
                    html,
                    replyTo: 'hello@purayidakrishi.com'
                });
            }
        }
        catch (e) {
            console.error('Order confirm email error', e);
            // continue even if email fails
        }
        res.json(order);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to confirm order' });
    }
});
router.delete('/post-comments/:id', requireRole('EDITOR'), async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id))
            return res.status(400).json({ error: 'Invalid id' });
        await prisma.postComment.delete({ where: { id } });
        res.status(204).send();
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete post comment' });
    }
});
// ===== Services CRUD =====
const serviceTranslationSchema = z.object({
    locale: z.enum(['en', 'ml']),
    title: z.string().min(1),
    description: z.string().optional(),
    details: z.string().optional(),
    slug: z.string().optional(),
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
});
const serviceCreateSchema = z.object({
    link: z.union([z.string().url(), z.string().regex(/^\//), z.string().regex(/^#\//)]).optional(),
    phone: z.string().optional(),
    email: z.string().email().optional().or(z.literal('')),
    translations: z.array(serviceTranslationSchema).min(1),
});
router.post('/services', requireRole('EDITOR'), async (req, res) => {
    try {
        const parsed = serviceCreateSchema.parse(req.body);
        // Auto-deduplicate slugs for new service (no serviceId to exclude)
        const translations = await Promise.all(parsed.translations.map(async (t) => {
            const desired = slugify(t.slug || t.title);
            const uniqueSlug = await ensureUniqueServiceSlugForCreate(desired, t.locale);
            return {
                ...t,
                slug: uniqueSlug,
            };
        }));
        const created = await prisma.service.create({
            data: {
                link: parsed.link,
                phone: parsed.phone || undefined,
                email: parsed.email || undefined,
                translations: { create: translations },
            },
            include: { translations: true },
        });
        res.status(201).json(created);
    }
    catch (err) {
        if (err instanceof z.ZodError)
            return res.status(400).json({ error: 'Invalid payload', details: err.issues });
        if (String(err.message || '').includes('Unique constraint'))
            return res.status(409).json({ error: 'Slug already exists for locale' });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ===== Books (EDITOR+) =====
const bookTranslationSchema = z.object({
    locale: z.enum(['en', 'ml']),
    name: z.string().min(1),
    description: z.string().optional(),
    slug: z.string().optional(),
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
});
const bookCreateSchema = z.object({
    price: z.string().optional(),
    // Accept relative paths like "/uploads/abc.jpg" or absolute URLs
    coverUrl: z.string().min(1).optional(),
    page1Url: z.string().min(1).optional(),
    page2Url: z.string().min(1).optional(),
    link: z.union([z.string().url(), z.string().regex(/^(\/#|#\/|\/)/)]).optional(),
    order: z.number().int().min(0).optional(),
    isPreorder: z.boolean().optional(),
    quality: z.string().optional(),
    status: z.enum(['PREBOOK', 'INSTOCK', 'SOLD_OUT']).optional(),
    stock: z.number().int().min(0).optional(),
    translations: z.array(bookTranslationSchema).min(1),
});
router.post('/books', requireRole('EDITOR'), async (req, res) => {
    try {
        const parsed = bookCreateSchema.parse(req.body);
        const translations = parsed.translations.map((t) => ({
            ...t,
            slug: slugify(t.slug || t.name),
        }));
        const created = await prisma.book.create({
            data: {
                price: parsed.price,
                coverUrl: parsed.coverUrl,
                page1Url: parsed.page1Url,
                page2Url: parsed.page2Url,
                link: parsed.link,
                order: parsed.order ?? 0,
                isPreorder: parsed.isPreorder ?? false,
                quality: parsed.quality ?? undefined,
                status: parsed.status ?? 'INSTOCK',
                stock: parsed.stock ?? 0,
                translations: { create: translations },
            },
            include: { translations: true },
        });
        res.status(201).json(created);
    }
    catch (err) {
        if (err instanceof z.ZodError)
            return res.status(400).json({ error: 'Invalid payload', details: err.issues });
        if (String(err.message || '').includes('Unique constraint'))
            return res.status(409).json({ error: 'Slug already exists for locale' });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/books', requireRole('EDITOR'), async (_req, res) => {
    const items = await prisma.book.findMany({ orderBy: { order: 'asc' }, include: { translations: true } });
    res.json(items);
});
router.get('/books/:id', requireRole('EDITOR'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
        return res.status(400).json({ error: 'Invalid id' });
    const item = await prisma.book.findUnique({ where: { id }, include: { translations: true } });
    if (!item)
        return res.status(404).json({ error: 'Not found' });
    res.json(item);
});
const bookUpdateSchema = z.object({
    price: z.string().optional(),
    coverUrl: z.string().min(1).optional(),
    page1Url: z.string().min(1).optional(),
    page2Url: z.string().min(1).optional(),
    link: z.union([z.string().url(), z.string().regex(/^(\/#|#\/|\/)/)]).optional(),
    order: z.number().int().min(0).optional(),
    isPreorder: z.boolean().optional(),
    quality: z.string().optional(),
    status: z.enum(['PREBOOK', 'INSTOCK', 'SOLD_OUT']).optional(),
    stock: z.number().int().min(0).optional(),
});
router.patch('/books/:id', requireRole('EDITOR'), async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id))
            return res.status(400).json({ error: 'Invalid id' });
        const data = bookUpdateSchema.parse(req.body);
        const updated = await prisma.book.update({ where: { id }, data, include: { translations: true } });
        res.json(updated);
    }
    catch (err) {
        if (err instanceof z.ZodError)
            return res.status(400).json({ error: 'Invalid payload', details: err.issues });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
const bookTranslationsUpdateSchema = z.object({ translations: z.array(bookTranslationSchema).min(1) });
router.patch('/books/:id/translations', requireRole('EDITOR'), async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id))
            return res.status(400).json({ error: 'Invalid id' });
        const parsed = bookTranslationsUpdateSchema.parse(req.body);
        for (const t of parsed.translations) {
            const data = {
                name: t.name,
                description: t.description ?? undefined,
                slug: slugify(t.slug || t.name),
                metaTitle: t.metaTitle ?? undefined,
                metaDescription: t.metaDescription ?? undefined,
            };
            const exists = await prisma.bookTranslation.findUnique({ where: { bookId_locale: { bookId: id, locale: t.locale } } });
            if (exists) {
                await prisma.bookTranslation.update({ where: { bookId_locale: { bookId: id, locale: t.locale } }, data });
            }
            else {
                await prisma.bookTranslation.create({ data: { ...data, bookId: id, locale: t.locale } });
            }
        }
        const updated = await prisma.book.findUnique({ where: { id }, include: { translations: true } });
        res.json(updated);
    }
    catch (err) {
        if (String(err.message || '').includes('Unique constraint'))
            return res.status(409).json({ error: 'Slug already exists for locale' });
        if (err instanceof z.ZodError)
            return res.status(400).json({ error: 'Invalid payload', details: err.issues });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.delete('/books/:id', requireRole('EDITOR'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
        return res.status(400).json({ error: 'Invalid id' });
    await prisma.book.delete({ where: { id } });
    res.status(204).send();
});
// ===== Book Comments (EDITOR+) =====
router.get('/book-comments', requireRole('EDITOR'), async (_req, res) => {
    const items = await prisma.bookComment.findMany({ orderBy: { createdAt: 'desc' }, include: { book: { include: { translations: { take: 1 } } } } });
    res.json(items);
});
router.delete('/book-comments/:id', requireRole('EDITOR'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
        return res.status(400).json({ error: 'Invalid id' });
    await prisma.bookComment.delete({ where: { id } });
    res.status(204).send();
});
// ===== ServicesPage (single type) =====
const servicesPageSchema = z.object({
    locale: z.enum(['en', 'ml']),
    heading: z.string().min(1),
    sub: z.string().optional(),
});
router.patch('/services-page', requireRole('EDITOR'), async (req, res) => {
    try {
        const parsed = servicesPageSchema.parse(req.body);
        await prisma.servicesPage.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
        const exists = await prisma.servicesPageTranslation.findUnique({ where: { servicesPageId_locale: { servicesPageId: 1, locale: parsed.locale } } });
        const data = { servicesPageId: 1, locale: parsed.locale, heading: parsed.heading, sub: parsed.sub ?? undefined };
        const result = exists
            ? await prisma.servicesPageTranslation.update({ where: { servicesPageId_locale: { servicesPageId: 1, locale: parsed.locale } }, data })
            : await prisma.servicesPageTranslation.create({ data });
        res.json(result);
    }
    catch (err) {
        if (err instanceof z.ZodError)
            return res.status(400).json({ error: 'Invalid payload', details: err.issues });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/services-page', requireRole('EDITOR'), async (req, res) => {
    const locale = req.query.locale === 'ml' ? 'ml' : 'en';
    const page = await prisma.servicesPage.findUnique({ where: { id: 1 }, include: { translations: { where: { locale }, take: 1 } } });
    const t = page?.translations?.[0];
    res.json({ heading: t?.heading ?? '', sub: t?.sub ?? '' });
});
router.get('/services', requireRole('EDITOR'), async (_req, res) => {
    const items = await prisma.service.findMany({ orderBy: { order: 'asc' }, include: { translations: true } });
    res.json(items);
});
const serviceUpdateSchema = z.object({
    link: z.union([z.string().url(), z.string().regex(/^\//), z.string().regex(/^#\//)]).optional(),
    phone: z.string().optional(),
    email: z.string().email().optional().or(z.literal('')),
});
router.patch('/services/:id', requireRole('EDITOR'), async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id))
            return res.status(400).json({ error: 'Invalid id' });
        const data = serviceUpdateSchema.parse(req.body);
        const updated = await prisma.service.update({ where: { id }, data, include: { translations: true } });
        res.json(updated);
    }
    catch (err) {
        if (err instanceof z.ZodError)
            return res.status(400).json({ error: 'Invalid payload', details: err.issues });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.delete('/services/:id', requireRole('EDITOR'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
        return res.status(400).json({ error: 'Invalid id' });
    await prisma.service.delete({ where: { id } });
    res.status(204).send();
});
// Upsert service translations (after schema definition)
const serviceTranslationsUpdateSchema = z.object({
    translations: z.array(serviceTranslationSchema).min(1),
});
router.patch('/services/:id/translations', requireRole('EDITOR'), async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id))
            return res.status(400).json({ error: 'Invalid id' });
        const parsed = serviceTranslationsUpdateSchema.parse(req.body);
        for (const t of parsed.translations) {
            const desired = slugify(t.slug || t.title);
            const uniqueSlug = await ensureUniqueServiceSlug(desired, t.locale, id);
            const data = { title: t.title, description: t.description ?? undefined, details: t.details ?? undefined, slug: uniqueSlug, metaTitle: t.metaTitle ?? undefined, metaDescription: t.metaDescription ?? undefined };
            const exists = await prisma.serviceTranslation.findUnique({ where: { serviceId_locale: { serviceId: id, locale: t.locale } } });
            if (exists) {
                await prisma.serviceTranslation.update({ where: { serviceId_locale: { serviceId: id, locale: t.locale } }, data });
            }
            else {
                await prisma.serviceTranslation.create({ data: { ...data, locale: t.locale, serviceId: id } });
            }
        }
        const updated = await prisma.service.findUnique({ where: { id }, include: { translations: true } });
        res.json(updated);
    }
    catch (err) {
        if (String(err.message || '').includes('Unique constraint'))
            return res.status(409).json({ error: 'Slug already exists for locale' });
        if (err instanceof z.ZodError)
            return res.status(400).json({ error: 'Invalid payload', details: err.issues });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ===== Gallery Images CRUD =====
const galleryCreateSchema = z.object({
    // Accept relative paths like "/uploads/abc.jpg" or absolute URLs
    imageUrl: z.string().min(1).optional(),
    videoUrl: z.string().min(1).optional(),
    // Keep YouTube as a well-formed URL
    youtubeUrl: z.string().url().optional(),
    type: z.enum(['image', 'video', 'youtube']).default('image'),
    order: z.number().int().min(0).optional(),
    groupId: z.number().int().min(1).optional(),
    translations: z.array(z.object({
        locale: z.enum(['en', 'ml']),
        caption: z.string().min(1),
        description: z.string().optional(),
    })).min(1),
});
router.post('/gallery-images', requireRole('EDITOR'), async (req, res) => {
    try {
        const parsed = galleryCreateSchema.parse(req.body);
        const created = await prisma.galleryImage.create({
            data: {
                imageUrl: parsed.imageUrl ?? undefined,
                videoUrl: parsed.videoUrl ?? undefined,
                youtubeUrl: parsed.youtubeUrl ?? undefined,
                type: parsed.type ?? 'image',
                order: parsed.order ?? 0,
                groupId: parsed.groupId ?? undefined,
                translations: { create: parsed.translations },
            },
            include: { translations: true },
        });
        res.status(201).json(created);
    }
    catch (err) {
        if (err instanceof z.ZodError)
            return res.status(400).json({ error: 'Invalid payload', details: err.issues });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/gallery-images', requireRole('EDITOR'), async (_req, res) => {
    const items = await prisma.galleryImage.findMany({ orderBy: { order: 'asc' }, include: { translations: true } });
    res.json(items);
});
// ===== Gallery Groups (Sets) =====
const galleryGroupCreateSchema = z.object({
    title: z.string().optional(),
    date: z.string().datetime().optional(),
    order: z.number().int().min(0).optional(),
});
router.post('/gallery-groups', requireRole('EDITOR'), async (req, res) => {
    try {
        const parsed = galleryGroupCreateSchema.parse(req.body);
        const created = await prisma.galleryGroup.create({
            data: {
                title: parsed.title ?? undefined,
                date: parsed.date ? new Date(parsed.date) : undefined,
                order: parsed.order ?? 0,
            },
        });
        res.status(201).json(created);
    }
    catch (err) {
        if (err instanceof z.ZodError)
            return res.status(400).json({ error: 'Invalid payload', details: err.issues });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/gallery-groups', requireRole('EDITOR'), async (_req, res) => {
    const groups = await prisma.galleryGroup.findMany({ orderBy: { order: 'asc' } });
    res.json(groups);
});
const galleryGroupUpdateSchema = z.object({
    title: z.string().optional(),
    date: z.string().datetime().optional(),
    order: z.number().int().min(0).optional(),
});
router.patch('/gallery-groups/:id', requireRole('EDITOR'), async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id))
            return res.status(400).json({ error: 'Invalid id' });
        const parsed = galleryGroupUpdateSchema.parse(req.body);
        const data = {};
        if (parsed.title !== undefined)
            data.title = parsed.title;
        if (parsed.date !== undefined)
            data.date = parsed.date ? new Date(parsed.date) : null;
        if (parsed.order !== undefined)
            data.order = parsed.order;
        const updated = await prisma.galleryGroup.update({ where: { id }, data });
        res.json(updated);
    }
    catch (err) {
        if (err instanceof z.ZodError)
            return res.status(400).json({ error: 'Invalid payload', details: err.issues });
        console.error(err);
        res.status(500).json({ error: 'Failed to update gallery group' });
    }
});
const galleryUpdateSchema = z.object({
    imageUrl: z.string().min(1).optional(),
    videoUrl: z.string().min(1).optional(),
    youtubeUrl: z.string().url().optional(),
    type: z.enum(['image', 'video', 'youtube']).optional(),
    order: z.number().int().min(0).optional(),
});
router.patch('/gallery-images/:id', requireRole('EDITOR'), async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id))
            return res.status(400).json({ error: 'Invalid id' });
        const parsed = galleryUpdateSchema.parse(req.body);
        const data = {};
        if (parsed.imageUrl !== undefined)
            data.imageUrl = parsed.imageUrl;
        if (parsed.videoUrl !== undefined)
            data.videoUrl = parsed.videoUrl;
        if (parsed.youtubeUrl !== undefined)
            data.youtubeUrl = parsed.youtubeUrl;
        if (parsed.type !== undefined)
            data.type = parsed.type;
        if (parsed.order !== undefined)
            data.order = parsed.order;
        const updated = await prisma.galleryImage.update({ where: { id }, data, include: { translations: true } });
        res.json(updated);
    }
    catch (err) {
        if (err instanceof z.ZodError)
            return res.status(400).json({ error: 'Invalid payload', details: err.issues });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.delete('/gallery-images/:id', requireRole('EDITOR'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
        return res.status(400).json({ error: 'Invalid id' });
    await prisma.galleryImage.delete({ where: { id } });
    res.status(204).send();
});
// Upsert gallery translations
const galleryTranslationsUpdateSchema = z.object({
    translations: z.array(z.object({
        locale: z.enum(['en', 'ml']),
        caption: z.string().min(1),
        description: z.string().optional(),
    })).min(1),
});
router.patch('/gallery-images/:id/translations', requireRole('EDITOR'), async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id))
            return res.status(400).json({ error: 'Invalid id' });
        const parsed = galleryTranslationsUpdateSchema.parse(req.body);
        for (const t of parsed.translations) {
            const data = { caption: t.caption, description: t.description ?? undefined };
            const exists = await prisma.galleryImageTranslation.findUnique({ where: { imageId_locale: { imageId: id, locale: t.locale } } });
            if (exists) {
                await prisma.galleryImageTranslation.update({ where: { imageId_locale: { imageId: id, locale: t.locale } }, data });
            }
            else {
                await prisma.galleryImageTranslation.create({ data: { ...data, locale: t.locale, imageId: id } });
            }
        }
        const updated = await prisma.galleryImage.findUnique({ where: { id }, include: { translations: true } });
        res.json(updated);
    }
    catch (err) {
        if (err instanceof z.ZodError)
            return res.status(400).json({ error: 'Invalid payload', details: err.issues });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ===== Pages (About, Contact) =====
const aboutSchema = z.object({
    locale: z.enum(['en', 'ml']),
    heading: z.string().min(1),
    body: z.string().min(1),
    points: z.array(z.string()).optional(),
});
router.patch('/about', requireRole('EDITOR'), async (req, res) => {
    try {
        const parsed = aboutSchema.parse(req.body);
        // Ensure singleton exists
        await prisma.aboutPage.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
        const exists = await prisma.aboutPageTranslation.findUnique({ where: { aboutId_locale: { aboutId: 1, locale: parsed.locale } } });
        const data = {
            aboutId: 1,
            locale: parsed.locale,
            heading: parsed.heading,
            body: parsed.body,
            points: parsed.points ? JSON.stringify(parsed.points) : undefined,
        };
        const result = exists
            ? await prisma.aboutPageTranslation.update({ where: { aboutId_locale: { aboutId: 1, locale: parsed.locale } }, data })
            : await prisma.aboutPageTranslation.create({ data });
        res.json(result);
    }
    catch (err) {
        if (err instanceof z.ZodError)
            return res.status(400).json({ error: 'Invalid payload', details: err.issues });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
const contactSchema = z.object({
    locale: z.enum(['en', 'ml']).optional(),
    heading: z.string().min(1).optional(),
    sub: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
});
router.patch('/contact', requireRole('EDITOR'), async (req, res) => {
    try {
        const parsed = contactSchema.parse(req.body);
        await prisma.contactPage.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
        if (parsed.email !== undefined || parsed.phone !== undefined) {
            await prisma.contactPage.update({ where: { id: 1 }, data: { email: parsed.email, phone: parsed.phone } });
        }
        if (parsed.locale) {
            const exists = await prisma.contactPageTranslation.findUnique({ where: { contactId_locale: { contactId: 1, locale: parsed.locale } } });
            const data = {
                contactId: 1,
                locale: parsed.locale,
                heading: parsed.heading ?? undefined,
                sub: parsed.sub ?? undefined,
            };
            if (exists) {
                await prisma.contactPageTranslation.update({ where: { contactId_locale: { contactId: 1, locale: parsed.locale } }, data });
            }
            else {
                await prisma.contactPageTranslation.create({ data: { ...data, heading: parsed.heading || 'Heading', sub: parsed.sub || '' } });
            }
        }
        const current = await prisma.contactPage.findUnique({ where: { id: 1 }, include: { translations: true } });
        res.json(current);
    }
    catch (err) {
        if (err instanceof z.ZodError)
            return res.status(400).json({ error: 'Invalid payload', details: err.issues });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/ping', requireRole('EDITOR'), (_req, res) => {
    res.json({ ok: true });
});
// ===== Site Settings (EDITOR+) =====
router.get('/settings', requireRole('EDITOR'), async (_req, res) => {
    try {
        let settings = await prisma.siteSettings.findUnique({ where: { id: 1 } });
        if (!settings)
            settings = await prisma.siteSettings.create({ data: { id: 1, defaultLocale: 'en' } });
        res.json(settings);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to load settings' });
    }
});
router.patch('/settings', requireRole('EDITOR'), async (req, res) => {
    try {
        const data = req.body || {};
        // Only accept whitelisted fields
        const update = {};
        if (data.heroBackgroundUrl !== undefined)
            update.heroBackgroundUrl = data.heroBackgroundUrl || null;
        if (data.agroecologyBackgroundUrl !== undefined)
            update.agroecologyBackgroundUrl = data.agroecologyBackgroundUrl || null;
        if (data.blogCommentsEmail !== undefined)
            update.blogCommentsEmail = data.blogCommentsEmail || null;
        if (data.bookOrdersEmail !== undefined)
            update.bookOrdersEmail = data.bookOrdersEmail || null;
        if (data.heroBox2Slug !== undefined)
            update.heroBox2Slug = data.heroBox2Slug || null;
        if (data.heroBox3Slug !== undefined)
            update.heroBox3Slug = data.heroBox3Slug || null;
        await prisma.siteSettings.upsert({ where: { id: 1 }, update, create: { id: 1, defaultLocale: 'en', ...update } });
        const current = await prisma.siteSettings.findUnique({ where: { id: 1 } });
        res.json(current);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to save settings' });
    }
});
// Example: list contact requests (EDITOR+)
router.get('/contact-requests', requireRole('EDITOR'), async (_req, res) => {
    const list = await prisma.contactRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    res.json(list);
});
// ===== Ads Metrics (EDITOR+) =====
router.get('/ads/metrics', requireRole('EDITOR'), async (_req, res) => {
    try {
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const [totalAds, publishedAds, draftAds, submitted, inReview, approved, rejected, recent] = await Promise.all([
            prisma.post.count({ where: { isAd: true } }),
            prisma.post.count({ where: { isAd: true, published: true } }),
            prisma.post.count({ where: { isAd: true, published: false } }),
            prisma.post.count({ where: { isAd: true, reviewStatus: 'submitted' } }),
            prisma.post.count({ where: { isAd: true, reviewStatus: 'in_review' } }),
            prisma.post.count({ where: { isAd: true, reviewStatus: 'approved' } }),
            prisma.post.count({ where: { isAd: true, reviewStatus: 'rejected' } }),
            prisma.post.findMany({
                where: { isAd: true },
                orderBy: { updatedAt: 'desc' },
                take: 8,
                include: { translations: true },
            }),
        ]);
        let missingEn = 0, missingMl = 0, missingImage = 0, missingCta = 0, updated7d = 0, created7d = 0;
        for (const ad of recent) {
            const hasEn = ad.translations.some((t) => t.locale === 'en');
            const hasMl = ad.translations.some((t) => t.locale === 'ml');
            if (!hasEn)
                missingEn++;
            if (!hasMl)
                missingMl++;
            if (!ad.imageUrl)
                missingImage++;
            if (!ad.ctaUrl)
                missingCta++;
            if (ad.updatedAt >= sevenDaysAgo)
                updated7d++;
            if (ad.createdAt >= sevenDaysAgo)
                created7d++;
        }
        const recentAds = recent.map((ad) => {
            const en = ad.translations.find((t) => t.locale === 'en');
            const ml = ad.translations.find((t) => t.locale === 'ml');
            return {
                id: ad.id,
                title: en?.title || ml?.title || null,
                published: ad.published,
                reviewStatus: ad.reviewStatus,
                hasEn: !!en,
                hasMl: !!ml,
                hasImage: !!ad.imageUrl,
                hasCta: !!ad.ctaUrl,
                updatedAt: ad.updatedAt,
            };
        });
        res.json({
            totals: { totalAds, publishedAds, draftAds },
            reviews: { submitted, inReview, approved, rejected },
            quality: { missingEn, missingMl, missingImage, missingCta },
            activity: { updated7d, created7d },
            recentAds,
            clicks: 0,
            impressions: 0,
            ctr: 0,
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Helpers
function slugify(input) {
    return input
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');
}
// Ensure a service translation slug is unique within a locale, excluding the current service ID.
async function ensureUniqueServiceSlug(desired, locale, serviceId) {
    let base = desired;
    let candidate = base;
    let n = 1;
    // First check the desired slug, then try -2, -3, ... if conflicts exist on other services
    // Note: allow same service to keep its own slug when updating
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const conflict = await prisma.serviceTranslation.findFirst({
            where: {
                slug: candidate,
                locale,
                NOT: { serviceId },
            },
            select: { id: true },
        });
        if (!conflict)
            return candidate;
        n += 1;
        candidate = `${base}-${n}`;
    }
}
// Ensure a service translation slug is unique for new service creation
async function ensureUniqueServiceSlugForCreate(desired, locale) {
    let base = desired;
    let candidate = base;
    let n = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const conflict = await prisma.serviceTranslation.findFirst({
            where: {
                slug: candidate,
                locale,
            },
            select: { id: true },
        });
        if (!conflict)
            return candidate;
        n += 1;
        candidate = `${base}-${n}`;
    }
}
// ===== Categories =====
const categoryCreateSchema = z.object({
    slug: z.string().min(1).optional(),
    name: z.object({ en: z.string().min(1), ml: z.string().min(1) }),
});
router.post('/categories', requireRole('EDITOR'), async (req, res) => {
    try {
        const parsed = categoryCreateSchema.parse(req.body);
        const slug = parsed.slug ? slugify(parsed.slug) : slugify(parsed.name.en);
        const created = await prisma.category.create({
            data: {
                slug,
                translations: {
                    create: [
                        { locale: 'en', name: parsed.name.en },
                        { locale: 'ml', name: parsed.name.ml },
                    ],
                },
            },
            include: { translations: true },
        });
        res.status(201).json(created);
    }
    catch (err) {
        if (err instanceof z.ZodError)
            return res.status(400).json({ error: 'Invalid payload', details: err.issues });
        if (String(err.message || '').includes('Unique constraint'))
            return res.status(409).json({ error: 'Slug already exists' });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/categories', requireRole('EDITOR'), async (_req, res) => {
    const items = await prisma.category.findMany({ include: { translations: true }, orderBy: { id: 'desc' } });
    res.json(items);
});
// ===== Posts =====
const postTranslationSchema = z.object({
    locale: z.enum(['en', 'ml']),
    title: z.string().min(1),
    excerpt: z.string().optional(),
    content: z.string().optional(),
    adText: z.string().optional(),
    ctaText: z.string().optional(),
    slug: z.string().min(1),
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
    categoryLabel: z.string().optional(),
});
const postCreateSchema = z.object({
    date: z.string().datetime().optional(),
    // Accept relative paths or absolute URLs for images
    imageUrl: z.string().min(1).optional(),
    isAd: z.boolean().optional(),
    adPlacement: z.enum(['home', 'subpages', 'all', 'blog_all', 'blog_detail']).optional(),
    adZone: z.enum(['top_ad', 'side_ad', 'bottom_ad', 'blog_specific', 'as_blog']).optional(),
    adBlogSlug: z.string().optional(),
    adBlogPostId: z.number().int().optional(),
    ctaUrl: z.string().url().optional(),
    categorySlug: z.string().optional(),
    translations: z.array(postTranslationSchema).min(1),
});
router.post('/posts', requireRole('EDITOR'), async (req, res) => {
    try {
        const parsed = postCreateSchema.parse(req.body);
        let categoryId = undefined;
        if (parsed.categorySlug) {
            const cat = await prisma.category.findUnique({ where: { slug: parsed.categorySlug } });
            if (!cat)
                return res.status(400).json({ error: 'Invalid categorySlug' });
            categoryId = cat.id;
        }
        // Normalize slugs
        const translations = parsed.translations.map((t) => ({
            ...t,
            slug: slugify(t.slug),
        }));
        const created = await prisma.post.create({
            data: {
                date: parsed.date ? new Date(parsed.date) : undefined,
                imageUrl: parsed.imageUrl,
                isAd: parsed.isAd ?? false,
                adPlacement: parsed.adPlacement ?? 'all',
                adZone: parsed.adZone ?? undefined,
                adBlogSlug: parsed.adBlogSlug ?? undefined,
                adBlogPostId: parsed.adBlogPostId ?? undefined,
                ctaUrl: parsed.ctaUrl,
                categoryId,
                translations: { create: translations },
            },
            include: { translations: true, category: true },
        });
        res.status(201).json(created);
    }
    catch (err) {
        if (err instanceof z.ZodError)
            return res.status(400).json({ error: 'Invalid payload', details: err.issues });
        if (String(err.message || '').includes('Unique constraint'))
            return res.status(409).json({ error: 'Slug already exists for locale' });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/posts', requireRole('EDITOR'), async (req, res) => {
    const locale = req.query.locale === 'ml' ? 'ml' : 'en';
    const list = await prisma.post.findMany({
        where: { translations: { some: { locale } } },
        orderBy: { id: 'desc' },
        include: { translations: { where: { locale }, take: 1 }, category: true },
        take: 50,
    });
    res.json(list);
});
// Get post by id
router.get('/posts/:id', requireRole('EDITOR'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
        return res.status(400).json({ error: 'Invalid id' });
    const post = await prisma.post.findUnique({ where: { id }, include: { translations: true, category: true } });
    if (!post)
        return res.status(404).json({ error: 'Not found' });
    res.json(post);
});
// Update post base fields
const postBaseUpdateSchema = z.object({
    date: z.string().datetime().optional(),
    imageUrl: z.string().min(1).optional(),
    isAd: z.boolean().optional(),
    adPlacement: z.enum(['home', 'subpages', 'all', 'blog_all', 'blog_detail']).optional(),
    adZone: z.enum(['top_ad', 'side_ad', 'bottom_ad', 'blog_specific', 'as_blog']).optional(),
    adBlogSlug: z.string().optional(),
    adBlogPostId: z.number().int().optional(),
    ctaUrl: z.string().url().optional(),
    categorySlug: z.string().optional(),
});
router.patch('/posts/:id', requireRole('EDITOR'), async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id))
            return res.status(400).json({ error: 'Invalid id' });
        const parsed = postBaseUpdateSchema.parse(req.body);
        let categoryId = undefined;
        if (parsed.categorySlug) {
            const cat = await prisma.category.findUnique({ where: { slug: parsed.categorySlug } });
            if (!cat)
                return res.status(400).json({ error: 'Invalid categorySlug' });
            categoryId = cat.id;
        }
        const updated = await prisma.post.update({
            where: { id },
            data: {
                date: parsed.date ? new Date(parsed.date) : undefined,
                imageUrl: parsed.imageUrl,
                isAd: parsed.isAd,
                adPlacement: parsed.adPlacement,
                adZone: parsed.adZone,
                adBlogSlug: parsed.adBlogSlug,
                adBlogPostId: parsed.adBlogPostId,
                ctaUrl: parsed.ctaUrl,
                categoryId,
            },
            include: { translations: true, category: true },
        });
        res.json(updated);
    }
    catch (err) {
        if (err instanceof z.ZodError)
            return res.status(400).json({ error: 'Invalid payload', details: err.issues });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Upsert post translations
const postTranslationsUpdateSchema = z.array(postTranslationSchema).min(1);
router.patch('/posts/:id/translations', requireRole('EDITOR'), async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id))
            return res.status(400).json({ error: 'Invalid id' });
        const translations = postTranslationsUpdateSchema.parse(req.body).map((t) => ({ ...t, slug: slugify(t.slug) }));
        for (const t of translations) {
            const data = { title: t.title, excerpt: t.excerpt ?? undefined, content: t.content ?? undefined, adText: t.adText ?? undefined, ctaText: t.ctaText ?? undefined, slug: t.slug, metaTitle: t.metaTitle ?? undefined, metaDescription: t.metaDescription ?? undefined, categoryLabel: t.categoryLabel ?? undefined };
            const exists = await prisma.postTranslation.findUnique({ where: { postId_locale: { postId: id, locale: t.locale } } });
            if (exists) {
                await prisma.postTranslation.update({ where: { postId_locale: { postId: id, locale: t.locale } }, data });
            }
            else {
                await prisma.postTranslation.create({ data: { ...data, postId: id, locale: t.locale } });
            }
        }
        const updated = await prisma.post.findUnique({ where: { id }, include: { translations: true, category: true } });
        res.json(updated);
    }
    catch (err) {
        if (String(err.message || '').includes('Unique constraint'))
            return res.status(409).json({ error: 'Slug already exists for locale' });
        if (err instanceof z.ZodError)
            return res.status(400).json({ error: 'Invalid payload', details: err.issues });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Delete post
router.delete('/posts/:id', requireRole('EDITOR'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
        return res.status(400).json({ error: 'Invalid id' });
    await prisma.post.delete({ where: { id } });
    res.status(204).send();
});
const reviewSchema = z.object({ status: z.enum(['submitted', 'in_review', 'approved', 'rejected']) });
router.patch('/posts/:id/publish', requireRole('EDITOR'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
        return res.status(400).json({ error: 'Invalid id' });
    const updated = await prisma.post.update({ where: { id }, data: { published: true } });
    res.json({ id: updated.id, published: updated.published });
});
router.patch('/posts/:id/unpublish', requireRole('EDITOR'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
        return res.status(400).json({ error: 'Invalid id' });
    const updated = await prisma.post.update({ where: { id }, data: { published: false } });
    res.json({ id: updated.id, published: updated.published });
});
router.patch('/posts/:id/review-status', requireRole('EDITOR'), async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id))
            return res.status(400).json({ error: 'Invalid id' });
        const parsed = reviewSchema.parse(req.body);
        const updated = await prisma.post.update({ where: { id }, data: { reviewStatus: parsed.status } });
        res.json({ id: updated.id, reviewStatus: updated.reviewStatus });
    }
    catch (err) {
        if (err instanceof z.ZodError)
            return res.status(400).json({ error: 'Invalid status' });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ===== Uploads (EDITOR+) =====
const envUploadsDir = process.env.UPLOADS_DIR;
const uploadsDir = envUploadsDir && envUploadsDir.trim() ? envUploadsDir : path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir))
    fs.mkdirSync(uploadsDir, { recursive: true });
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const base = path.basename(file.originalname, ext).toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, `${base}-${unique}${ext}`);
    },
});
const fileFilter = (_req, file, cb) => {
    const allowed = [
        'image/jpeg',
        'image/png',
        'image/webp',
        'video/mp4',
        'video/webm',
        'video/ogg',
    ];
    if (!allowed.includes(file.mimetype))
        return cb(new Error('Invalid file type'));
    cb(null, true);
};
// Increase max file size to 100MB to accommodate videos
const upload = multer({ storage, fileFilter, limits: { fileSize: 100 * 1024 * 1024 } });
router.post('/upload', requireRole('EDITOR'), upload.single('file'), (req, res) => {
    try {
        if (!req.file)
            return res.status(400).json({ error: 'No file uploaded' });
        const publicPath = `/uploads/${req.file.filename}`;
        res.status(201).json({ url: publicPath });
    }
    catch (err) {
        res.status(400).json({ error: err.message || 'Upload failed' });
    }
});
// ===== Orders Management =====
router.get('/orders', requireRole('EDITOR'), async (_req, res) => {
    try {
        const orders = await prisma.order.findMany({
            include: {
                items: {
                    include: {
                        book: {
                            include: {
                                translations: {
                                    where: { locale: 'en' }
                                }
                            }
                        }
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        // Format the response to include book names
        const formattedOrders = orders.map(order => ({
            ...order,
            items: order.items.map(item => ({
                ...item,
                book: item.book ? {
                    id: item.book.id,
                    name: item.book.translations[0]?.name || 'Unknown Book',
                    price: item.book.price
                } : null
            }))
        }));
        res.json(formattedOrders);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});
router.patch('/orders/:id', requireRole('EDITOR'), async (req, res) => {
    try {
        const { id } = req.params;
        const { status, paymentStatus } = req.body;
        const updateData = {};
        if (status)
            updateData.status = status;
        if (paymentStatus)
            updateData.paymentStatus = paymentStatus;
        const updated = await prisma.order.update({
            where: { id: Number(id) },
            data: updateData
        });
        res.json(updated);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update order' });
    }
});
// ===== Site Settings =====
const settingsUpdateSchema = z.object({
    heroBackgroundUrl: z.string().url().optional(),
    agroecologyBackgroundUrl: z.string().url().optional(),
    blogCommentsEmail: z.string().email().optional(),
    bookOrdersEmail: z.string().email().optional(),
});
router.patch('/settings', requireRole('EDITOR'), async (req, res) => {
    try {
        const parsed = settingsUpdateSchema.parse(req.body);
        const data = {};
        if (parsed.heroBackgroundUrl !== undefined)
            data.heroBackgroundUrl = parsed.heroBackgroundUrl;
        if (parsed.agroecologyBackgroundUrl !== undefined)
            data.agroecologyBackgroundUrl = parsed.agroecologyBackgroundUrl;
        if (parsed.blogCommentsEmail !== undefined)
            data.blogCommentsEmail = parsed.blogCommentsEmail;
        if (parsed.bookOrdersEmail !== undefined)
            data.bookOrdersEmail = parsed.bookOrdersEmail;
        let settings = await prisma.siteSettings.findUnique({ where: { id: 1 } });
        if (!settings) {
            // Create if not exists
            settings = await prisma.siteSettings.create({
                data: { id: 1, defaultLocale: 'en', ...data }
            });
        }
        else {
            settings = await prisma.siteSettings.update({ where: { id: 1 }, data });
        }
        res.json(settings);
    }
    catch (err) {
        if (err instanceof z.ZodError)
            return res.status(400).json({ error: 'Invalid payload', details: err.issues });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ===== Email Sending =====
router.post('/send-email', requireRole('EDITOR'), async (req, res) => {
    try {
        const { to, subject, message, orderId } = req.body;
        if (!to || !subject || !message) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
        if (!SMTP_HOST || !SMTP_PORT)
            return res.status(500).json({ error: 'Email not configured' });
        const transporter = nodemailer.createTransport({
            host: SMTP_HOST,
            port: Number(SMTP_PORT) || 587,
            secure: false,
            auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
        });
        await transporter.sendMail({ from: 'books@purayidakrishi.com', to, subject, text: message });
        res.json({ success: true });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to send email' });
    }
});
export default router;
