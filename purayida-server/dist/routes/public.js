import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Router } from 'express';
import { prisma } from '../prisma.js';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import nodemailer from 'nodemailer';
const router = Router();
function getLocale(value) {
    return value === 'ml' ? 'ml' : 'en';
}
// GET /api/posts
router.get('/posts', async (req, res) => {
    try {
        const locale = getLocale(req.query.locale);
        const categorySlug = req.query.category || undefined;
        const page = Math.max(1, parseInt(req.query.page || '1', 10));
        let pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize || '9', 10)));
        let skip = (page - 1) * pageSize;
        // Optional ads filter and limit for simple ad feeds
        const isAdParam = req.query.isAd || undefined;
        const placementParam = req.query.placement || undefined; // home | blog_all | blog_detail | all
        const blogSlugParam = req.query.blogSlug || undefined;
        const limitParam = req.query.limit || undefined;
        let isAd = undefined;
        if (isAdParam === 'true')
            isAd = true;
        else if (isAdParam === 'false')
            isAd = false;
        if (limitParam) {
            const limit = Math.min(50, Math.max(1, parseInt(limitParam, 10)));
            if (Number.isFinite(limit)) {
                pageSize = limit;
                skip = 0;
            }
        }
        let categoryId;
        if (categorySlug) {
            const cat = await prisma.category.findUnique({ where: { slug: categorySlug } });
            // ===== Server-side Share Preview (OG tags) =====
            function escapeHtml(s) {
                return s
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#39;');
            }
            async function renderShareHtml(slug, locale, req) {
                const t = await prisma.postTranslation.findFirst({
                    where: { slug, locale },
                    include: { post: true },
                });
                if (!t || !t.post || !t.post.published)
                    return null;
                const host = req.get('host');
                const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
                const baseUrl = `${proto}://${host}`;
                const pageUrl = `${baseUrl}/#/blog/${locale}/${encodeURIComponent(slug)}`;
                const title = escapeHtml(t.metaTitle || t.title || 'Purayida Krishi');
                const description = escapeHtml(t.metaDescription || t.excerpt || 'Sustainable Agriculture & Organic Farming');
                const imageUrl = t.post.imageUrl ? (t.post.imageUrl.startsWith('http') ? t.post.imageUrl : `${baseUrl}${t.post.imageUrl}`) : `${baseUrl}/purayida-krishi-logo-file.png`;
                return `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <meta name="description" content="${description}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${imageUrl}" />
  <meta property="og:url" content="${pageUrl}" />
  <meta property="og:type" content="article" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${imageUrl}" />
  <meta http-equiv="refresh" content="0; url=${pageUrl}" />
</head>
<body>
  <p>Redirecting to <a href="${pageUrl}">${title}</a>…</p>
</body>
</html>`;
            }
            router.get('/share/:slug', async (req, res) => {
                try {
                    const slug = String(req.params.slug);
                    const locale = 'en';
                    const html = await renderShareHtml(slug, locale, req);
                    if (!html)
                        return res.status(404).send('Not found');
                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    res.send(html);
                }
                catch (err) {
                    console.error(err);
                    res.status(500).send('Internal server error');
                }
            });
            router.get('/share/:locale/:slug', async (req, res) => {
                try {
                    const slug = String(req.params.slug);
                    const locale = (req.params.locale === 'ml' ? 'ml' : 'en');
                    const html = await renderShareHtml(slug, locale, req);
                    if (!html)
                        return res.status(404).send('Not found');
                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    res.send(html);
                }
                catch (err) {
                    console.error(err);
                    res.status(500).send('Internal server error');
                }
            });
            if (!cat)
                return res.status(404).json({ error: 'Category not found' });
            categoryId = cat.id;
        }
        // Build where clause with optional ad placement filter
        const whereClause = { categoryId: categoryId ?? undefined, published: true };
        if (isAd !== undefined) {
            whereClause.isAd = isAd;
            if (placementParam) {
                // Placement handling
                if (placementParam === 'home') {
                    whereClause.adPlacement = { in: ['all', 'home'] };
                }
                else if (placementParam === 'blog_all') {
                    whereClause.adPlacement = { in: ['all', 'blog_all'] };
                }
                else if (placementParam === 'blog_detail') {
                    whereClause.adPlacement = { in: ['all', 'blog_detail'] };
                    if (blogSlugParam) {
                        // Allow ads with adBlogSlug null (generic) or matching the blog slug
                        whereClause.OR = [
                            { adBlogSlug: null },
                            { adBlogSlug: blogSlugParam },
                        ];
                    }
                }
                else if (placementParam === 'all') {
                    // all ads
                }
            }
        }
        const [total, posts] = await Promise.all([
            prisma.post.count({ where: whereClause }),
            prisma.post.findMany({
                where: whereClause,
                orderBy: { date: 'desc' },
                skip,
                take: pageSize,
                include: {
                    translations: { where: { locale }, take: 1 },
                    category: { include: { translations: { where: { locale }, take: 1 } } },
                },
            }),
        ]);
        const items = posts.map((p) => {
            const t = p.translations[0];
            return {
                id: p.id,
                title: t?.title ?? null,
                excerpt: t?.excerpt ?? null,
                content: t?.content ?? null,
                adText: t?.adText ?? null,
                ctaText: t?.ctaText ?? null,
                slug: t?.slug ?? null,
                metaTitle: t?.metaTitle ?? null,
                metaDescription: t?.metaDescription ?? null,
                categoryLabel: t?.categoryLabel ?? null,
                date: p.date,
                imageUrl: p.imageUrl,
                isAd: p.isAd,
                ctaUrl: p.ctaUrl,
                category: p.category ? { slug: p.category.slug, name: p.category.translations?.[0]?.name ?? p.category.slug } : null,
            };
        });
        res.json({ page, pageSize, total, items });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /api/ads
router.get('/ads', async (req, res) => {
    try {
        const locale = getLocale(req.query.locale);
        const zoneParam = req.query.zone;
        const placementParam = req.query.placement;
        const postIdParam = req.query.postId;
        const limitParam = req.query.limit;
        const allowedZones = new Set(['top_ad', 'side_ad', 'bottom_ad', 'blog_specific', 'as_blog']);
        const allowedPlacements = new Set(['home', 'blog_all', 'blog_detail', 'all']);
        const zone = zoneParam && allowedZones.has(zoneParam) ? zoneParam : undefined;
        const placement = placementParam && allowedPlacements.has(placementParam) ? placementParam : undefined;
        let postId;
        if (postIdParam !== undefined) {
            const parsed = Number(postIdParam);
            if (!Number.isFinite(parsed) || parsed < 0) {
                return res.status(400).json({ error: 'Invalid postId' });
            }
            postId = parsed;
        }
        let limit = 5;
        if (limitParam !== undefined) {
            const parsed = Number(limitParam);
            if (!Number.isFinite(parsed) || parsed <= 0) {
                return res.status(400).json({ error: 'Invalid limit' });
            }
            limit = Math.min(parsed, 20);
        }
        const whereClause = { isAd: true, published: true };
        if (zone)
            whereClause.adZone = zone;
        if (placement) {
            if (placement === 'home') {
                whereClause.adPlacement = { in: ['all', 'home'] };
            }
            else if (placement === 'blog_all') {
                whereClause.adPlacement = { in: ['all', 'blog_all'] };
            }
            else if (placement === 'blog_detail') {
                whereClause.adPlacement = { in: ['all', 'blog_detail'] };
            }
        }
        if (postId !== undefined) {
            if (zone === 'blog_specific') {
                whereClause.adBlogPostId = postId;
            }
            else {
                whereClause.OR = [
                    { adBlogPostId: postId },
                    { adBlogPostId: null },
                ];
            }
        }
        const orderBy = [];
        if (postId !== undefined && zone !== 'blog_specific') {
            orderBy.push({ adBlogPostId: 'desc' });
        }
        orderBy.push({ updatedAt: 'desc' });
        const ads = (await prisma.post.findMany({
            where: whereClause,
            take: limit,
            orderBy,
            include: {
                translations: { where: { locale }, take: 1 },
                category: true,
            },
        }));
        const items = ads.map((ad) => {
            const t = ad.translations[0];
            return {
                id: ad.id,
                title: t?.title ?? null,
                excerpt: t?.excerpt ?? null,
                content: t?.content ?? null,
                adText: t?.adText ?? null,
                ctaText: t?.ctaText ?? null,
                slug: t?.slug ?? null,
                metaTitle: t?.metaTitle ?? null,
                metaDescription: t?.metaDescription ?? null,
                date: ad.date,
                imageUrl: ad.imageUrl,
                ctaUrl: ad.ctaUrl,
                adZone: ad.adZone ?? null,
                adPlacement: ad.adPlacement,
                adBlogPostId: ad.adBlogPostId ?? null,
                category: ad.category ? { slug: ad.category.slug } : null,
            };
        });
        res.json({ items });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /api/services-page
router.get('/services-page', async (req, res) => {
    try {
        const locale = getLocale(req.query.locale);
        const sp = await prisma.servicesPage.findUnique({ where: { id: 1 }, include: { translations: { where: { locale }, take: 1 } } });
        const t = sp?.translations[0];
        res.json({ heading: t?.heading ?? '', sub: t?.sub ?? '' });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /api/posts/:slug
router.get('/posts/:slug', async (req, res) => {
    try {
        const locale = getLocale(req.query.locale);
        const slug = req.params.slug;
        const t = await prisma.postTranslation.findUnique({ where: { slug_locale: { slug, locale } }, include: { post: { include: { category: { include: { translations: { where: { locale }, take: 1 } } } } } } });
        if (!t || !t.post.published)
            return res.status(404).json({ error: 'Not found' });
        res.json({
            id: t.postId,
            title: t.title,
            excerpt: t.excerpt,
            content: t.content,
            adText: t.adText,
            ctaText: t.ctaText,
            slug: t.slug,
            metaTitle: t.metaTitle,
            metaDescription: t.metaDescription,
            categoryLabel: t.categoryLabel ?? null,
            date: t.post.date,
            imageUrl: t.post.imageUrl,
            isAd: t.post.isAd,
            ctaUrl: t.post.ctaUrl,
            category: t.post.category ? { slug: t.post.category.slug, name: t.post.category.translations?.[0]?.name ?? t.post.category.slug } : null,
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /api/categories
router.get('/categories', async (req, res) => {
    try {
        const locale = getLocale(req.query.locale);
        const categories = await prisma.category.findMany({ include: { translations: { where: { locale }, take: 1 } } });
        const items = categories.map((c) => ({ slug: c.slug, name: c.translations[0]?.name ?? c.slug }));
        res.json(items);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /api/gallery-sets - grouped sets with images
router.get('/gallery-sets', async (req, res) => {
    try {
        const locale = getLocale(req.query.locale);
        const groups = await prisma.galleryGroup.findMany({ orderBy: { date: 'desc' } });
        if (!groups.length)
            return res.json([]);
        const ids = groups.map((g) => g.id);
        const images = (await prisma.galleryImage.findMany({
            where: { groupId: { in: ids } },
            orderBy: { order: 'asc' },
            include: { translations: { where: { locale }, take: 1 } },
        }));
        const byGroup = {};
        for (const img of images) {
            const type = img.type ?? (img.youtubeUrl ? 'youtube' : (img.videoUrl ? 'video' : 'image'));
            const t = img.translations?.[0];
            const mapped = {
                id: img.id,
                imageUrl: img.imageUrl ?? null,
                videoUrl: img.videoUrl ?? null,
                youtubeUrl: img.youtubeUrl ?? null,
                type,
                caption: t?.caption ?? '',
                description: t?.description ?? '',
                order: img.order,
            };
            if (!byGroup[img.groupId])
                byGroup[img.groupId] = [];
            byGroup[img.groupId].push(mapped);
        }
        const result = groups.map((g) => ({
            id: g.id,
            title: g.title ?? null,
            date: g.date ?? null,
            images: byGroup[g.id] || [],
        }));
        res.json(result);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /api/services/:slug
router.get('/services/:slug', async (req, res) => {
    try {
        const locale = getLocale(req.query.locale);
        const incoming = req.params.slug;
        const norm = (s) => s
            .toLowerCase()
            .normalize('NFKD')
            // @ts-ignore - unicode escape retained
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)+/g, '');
        // 1) Try direct match by stored translation slug
        let service = await prisma.service.findFirst({
            where: { translations: { some: { locale, slug: incoming } } },
            include: { translations: { where: { locale }, take: 1 } },
        });
        // 2) Fallback: match by slugified title if slug is missing in DB
        if (!service) {
            const candidates = await prisma.service.findMany({
                include: { translations: { where: { locale }, take: 1 } },
            });
            service = (candidates.find((s) => {
                const t = s.translations?.[0];
                if (!t?.title)
                    return false;
                return norm(t.title) === incoming;
            }) || null);
        }
        const t = service?.translations?.[0];
        if (!service || !t)
            return res.status(404).json({ error: 'Not found' });
        res.json({
            id: service.id,
            title: t.title ?? null,
            description: t.description ?? null,
            details: t.details ?? null,
            slug: t.slug ?? null,
            metaTitle: t.metaTitle ?? null,
            metaDescription: t.metaDescription ?? null,
            link: service.link ?? null,
            order: service.order,
            phone: service.phone ?? null,
            email: service.email ?? null,
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /api/books
router.get('/books', async (req, res) => {
    try {
        const locale = getLocale(req.query.locale);
        const books = await prisma.book.findMany({
            orderBy: { order: 'asc' },
            include: { translations: { where: { locale }, take: 1 } },
        });
        const items = books.map((b) => ({
            id: b.id,
            name: b.translations[0]?.name ?? null,
            description: b.translations[0]?.description ?? null,
            slug: b.translations[0]?.slug ?? null,
            metaTitle: b.translations[0]?.metaTitle ?? null,
            metaDescription: b.translations[0]?.metaDescription ?? null,
            price: b.price ?? null,
            coverUrl: b.coverUrl ?? null,
            page1Url: b.page1Url ?? null,
            page2Url: b.page2Url ?? null,
            quality: b.quality ?? null,
            status: b.status ?? 'INSTOCK',
            stock: b.stock ?? 0,
            isPreorder: b.isPreorder ?? false,
            link: b.link ?? null,
            order: b.order,
        }));
        res.json(items);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /api/books/:slug
router.get('/books/:slug', async (req, res) => {
    try {
        const locale = getLocale(req.query.locale);
        const slug = req.params.slug;
        const t = await prisma.bookTranslation.findUnique({ where: { slug_locale: { slug, locale } }, include: { book: true } });
        if (!t)
            return res.status(404).json({ error: 'Not found' });
        res.json({
            id: t.bookId,
            name: t.name,
            description: t.description ?? null,
            slug: t.slug,
            metaTitle: t.metaTitle ?? null,
            metaDescription: t.metaDescription ?? null,
            price: t.book.price ?? null,
            coverUrl: t.book.coverUrl ?? null,
            page1Url: t.book.page1Url ?? null,
            page2Url: t.book.page2Url ?? null,
            quality: t.book.quality ?? null,
            status: t.book.status ?? 'INSTOCK',
            stock: t.book.stock ?? 0,
            isPreorder: t.book.isPreorder ?? false,
            link: t.book.link ?? null,
            order: t.book.order,
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /api/gallery-images
router.get('/gallery-images', async (req, res) => {
    try {
        const locale = getLocale(req.query.locale);
        const images = await prisma.galleryImage.findMany({
            orderBy: { order: 'asc' },
            include: { translations: { where: { locale }, take: 1 } },
        });
        const items = images.map((g) => ({
            id: g.id,
            imageUrl: g.imageUrl,
            videoUrl: g.videoUrl ?? null,
            youtubeUrl: g.youtubeUrl ?? null,
            type: g.type ?? (g.youtubeUrl ? 'youtube' : (g.videoUrl ? 'video' : 'image')),
            caption: g.translations[0]?.caption ?? null,
            description: g.translations[0]?.description ?? null,
            order: g.order,
        }));
        res.json(items);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /api/services
router.get('/services', async (req, res) => {
    try {
        const locale = getLocale(req.query.locale);
        const services = await prisma.service.findMany({
            orderBy: { order: 'asc' },
            include: { translations: { where: { locale }, take: 1 } },
        });
        const items = services.map((s) => ({
            id: s.id,
            title: s.translations[0]?.title ?? null,
            description: s.translations[0]?.description ?? null,
            details: s.translations[0]?.details ?? null,
            slug: s.translations[0]?.slug ?? null,
            metaTitle: s.translations[0]?.metaTitle ?? null,
            metaDescription: s.translations[0]?.metaDescription ?? null,
            link: s.link,
            order: s.order,
            phone: s.phone ?? null,
            email: s.email ?? null,
        }));
        res.json(items);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /api/about
router.get('/about', async (req, res) => {
    try {
        const locale = getLocale(req.query.locale);
        const about = await prisma.aboutPage.findUnique({ where: { id: 1 }, include: { translations: { where: { locale }, take: 1 } } });
        const t = about?.translations[0];
        let points = [];
        if (t?.points) {
            try {
                const parsed = JSON.parse(t.points);
                if (Array.isArray(parsed)) {
                    points = parsed.filter((p) => typeof p === 'string');
                }
            }
            catch (_e) {
                // ignore parse errors and return empty array
            }
        }
        res.json({ heading: t?.heading ?? '', body: t?.body ?? '', points });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /api/contact
router.get('/contact', async (req, res) => {
    try {
        const locale = getLocale(req.query.locale);
        const cp = await prisma.contactPage.findUnique({ where: { id: 1 }, include: { translations: { where: { locale }, take: 1 } } });
        const t = cp?.translations[0];
        res.json({ heading: t?.heading ?? '', sub: t?.sub ?? '', email: cp?.email ?? null });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// POST /api/contact-requests
const contactLimiter = rateLimit({ windowMs: 60 * 1000, max: 5 });
router.post('/contact-requests', contactLimiter, async (req, res) => {
    try {
        const { name, email, subject, message } = req.body || {};
        if (!name || !email || !subject || !message) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        if (name.length > 200 || subject.length > 200 || message.length > 5000) {
            return res.status(400).json({ error: 'Input too long' });
        }
        const created = await prisma.contactRequest.create({ data: { name, email, subject, message } });
        // Send acknowledgement email to the requester (non-blocking for API reliability)
        (async () => {
            try {
                const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ADMIN_EMAIL } = process.env;
                if (SMTP_HOST && SMTP_PORT && email) {
                    const port = Number(SMTP_PORT) || 587;
                    const isSSL = port === 465;
                    const transporter = nodemailer.createTransport({
                        host: SMTP_HOST,
                        port,
                        secure: isSSL,
                        connectionTimeout: 10000, // 10 seconds
                        greetingTimeout: 5000, // 5 seconds
                        socketTimeout: 10000, // 10 seconds
                        auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
                        tls: isSSL ? undefined : {
                            ciphers: 'SSLv3',
                            rejectUnauthorized: false
                        }
                    });
                    // Quick verification to help diagnose SMTP issues in logs
                    try {
                        await transporter.verify();
                        console.log(`[mail] SMTP verified for contact ack (${SMTP_HOST}:${port}, secure:${isSSL})`);
                    }
                    catch (ve) {
                        console.warn(`[mail] SMTP verify failed for contact ack (${SMTP_HOST}:${port}, secure:${isSSL})`, ve?.message || ve);
                        // Don't return here - still try to send the email
                    }
                    // Use authenticated mailbox as From to satisfy DMARC/SPF. Put alias in replyTo.
                    const from = SMTP_USER ? `Purayida Krishi <${SMTP_USER}>` : 'Purayida Krishi <info@purayidakrishi.com>';
                    const replyTo = 'advt@purayidakrishi.com';
                    const subj = 'We have received your request';
                    // Different email content based on request type
                    let emailText, emailIntro;
                    if (subject?.includes('Garden Planning') || subject?.includes('Get in Touch')) {
                        emailIntro = 'Thank you for your interest in our garden planning services. We have received your request and our team will get back to you as soon as possible to discuss your space and goals.';
                        emailText = `Dear ${name},\n\n${emailIntro}\n\nYour Request:\n${message}\n\nWe look forward to helping you create a sustainable and productive garden space.\n\nBest regards,\nPurayida Krishi Team`;
                    }
                    else if (subject?.includes('Request Consultation') || subject?.includes('Advertise')) {
                        emailIntro = 'Thank you for your interest in our consultation services. We have received your request and our team will contact you as soon as possible.';
                        emailText = `Dear ${name},\n\n${emailIntro}\n\nSubject: ${subject}\n\nMessage:\n${message}\n\nBest regards,\nPurayida Krishi Team`;
                    }
                    else {
                        emailIntro = 'Thank you for contacting Purayida Krishi. We have received your message and our team will get back to you as soon as possible.';
                        emailText = `Dear ${name},\n\n${emailIntro}\n\nSubject: ${subject}\n\nMessage:\n${message}\n\nBest regards,\nPurayida Krishi Team`;
                    }
                    const html = `
            <div style="font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111827">
              <p>Dear ${name},</p>
              <p>${emailIntro}</p>
              <p style="margin:16px 0 4px;font-weight:600">Subject:</p>
              <p style="margin:0 0 12px;background:#f9fafb;border-left:4px solid #2d5016;padding:8px 10px">${(subject || '').toString().replace(/</g, '&lt;')}</p>
              <p style="margin:16px 0 4px;font-weight:600">Message:</p>
              <pre style="white-space:pre-wrap;margin:0;background:#f9fafb;border-left:4px solid #2d5016;padding:8px 10px">${(message || '').toString().replace(/</g, '&lt;')}</pre>
              <p style="margin-top:16px">Best regards,<br/>Purayida Krishi Team</p>
            </div>`;
                    // Determine admin CC from settings or env
                    let cc;
                    try {
                        const settings = await prisma.siteSettings.findUnique({ where: { id: 1 } });
                        cc = settings?.contactEmail || ADMIN_EMAIL || 'hello@purayidakrishi.com';
                        // Ensure we don't use example emails
                        if (cc && cc.includes('example.com')) {
                            cc = 'hello@purayidakrishi.com';
                        }
                    }
                    catch (_) {
                        cc = 'hello@purayidakrishi.com';
                    }
                    const mailOptions = {
                        from,
                        to: email,
                        subject: subj,
                        text: emailText,
                        html,
                        replyTo,
                        cc,
                        // Use sender/envelope to align with authenticated user for better deliverability
                        sender: SMTP_USER || from,
                        envelope: { from: SMTP_USER || from, to: [email, ...(cc ? [cc] : [])] },
                    };
                    try {
                        const info = await transporter.sendMail(mailOptions);
                        console.log('[mail] contact ack sent', info?.messageId || 'no-id');
                    }
                    catch (sendErr) {
                        console.error('[mail] contact ack send error', sendErr);
                    }
                }
            }
            catch (e) {
                console.error('Contact request ack email error', e);
            }
        })();
        res.status(201).json({ id: created.id, createdAt: created.createdAt });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ===== Orders =====
const orderLimiter = rateLimit({ windowMs: 60 * 1000, max: 5 });
const orderItemSchema = z.object({ bookId: z.number().int().min(1), quantity: z.number().int().min(1).max(20) });
const orderCreateSchema = z.object({
    name: z.string().min(1).max(200),
    email: z.string().email().optional(),
    phone: z.string().min(7).max(20),
    address: z.string().min(5).max(1000),
    city: z.string().max(120).optional(),
    pincode: z.string().max(20).optional(),
    notes: z.string().max(1000).optional(),
    // Accept both absolute and relative URLs (e.g., "/uploads/...")
    paymentProofUrl: z.string().min(1).max(500).optional(),
    preorder: z.boolean().optional(),
    items: z.array(orderItemSchema).min(1).max(50),
}).superRefine((data, ctx) => {
    // Require payment proof unless preorder is explicitly true
    const isPre = data.preorder === true;
    const hasProof = typeof data.paymentProofUrl === 'string' && data.paymentProofUrl.trim().length > 0;
    if (!isPre && !hasProof) {
        ctx.addIssue({
            path: ['paymentProofUrl'],
            code: z.ZodIssueCode.custom,
            message: 'Payment screenshot is required unless this is a preorder',
        });
    }
});
function parsePriceToNumber(p) {
    if (!p)
        return 0;
    const digits = String(p).replace(/[^0-9]/g, '');
    const n = parseInt(digits || '0', 10);
    return Number.isFinite(n) ? n : 0;
}
router.post('/orders', orderLimiter, async (req, res) => {
    try {
        const parsed = orderCreateSchema.parse(req.body || {});
        const bookIds = parsed.items.map((i) => i.bookId);
        const books = await prisma.book.findMany({ where: { id: { in: bookIds } } });
        if (books.length !== bookIds.length)
            return res.status(400).json({ error: 'Invalid book in items' });
        const totalAmount = parsed.items.reduce((sum, it) => {
            const b = books.find((bb) => bb.id === it.bookId);
            return sum + parsePriceToNumber(b.price) * it.quantity;
        }, 0);
        const totalRs = totalAmount ? `₹${totalAmount}` : undefined;
        // Determine if any book is marked as preorder
        const hasPreorderBook = books.some((b) => b.isPreorder === true);
        const created = await prisma.order.create({
            data: {
                name: parsed.name,
                email: parsed.email ?? undefined,
                phone: parsed.phone,
                address: parsed.address,
                city: parsed.city ?? undefined,
                pincode: parsed.pincode ?? undefined,
                notes: parsed.notes ?? undefined,
                paymentProofUrl: parsed.paymentProofUrl ?? undefined,
                preorder: hasPreorderBook || (parsed.preorder ?? false),
                total: totalRs,
                items: {
                    create: parsed.items.map((it) => {
                        const b = books.find((bb) => bb.id === it.bookId);
                        return { bookId: it.bookId, quantity: it.quantity, price: b.price ?? null };
                    }),
                },
            },
            include: { items: true },
        });
        // Send order confirmation emails (non-blocking)
        (async () => {
            try {
                const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ADMIN_EMAIL } = process.env;
                if (SMTP_HOST && SMTP_PORT) {
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
                    const itemsText = created.items.map((it) => `#${it.bookId} x ${it.quantity} @ ${it.price || ''}`).join('\n');
                    const itemsHtml = created.items.map((it) => `<tr><td style="padding:8px;border:1px solid #ddd;">Book #${it.bookId}</td><td style="padding:8px;border:1px solid #ddd;">${it.quantity}</td><td style="padding:8px;border:1px solid #ddd;">${it.price || 'N/A'}</td></tr>`).join('');
                    // Admin notification email
                    const settings = await prisma.siteSettings.findUnique({ where: { id: 1 } });
                    const adminTo = settings?.bookOrdersEmail || settings?.contactEmail || ADMIN_EMAIL || 'hello@purayidakrishi.com';
                    if (adminTo && !adminTo.includes('example.com')) {
                        const adminBody = `New order #${created.id}\nName: ${created.name}\nPhone: ${created.phone}\nEmail: ${created.email || ''}\nAddress: ${created.address}\nCity: ${created.city || ''}\nPincode: ${created.pincode || ''}\nPreorder: ${created.preorder}\nTotal: ${created.total || ''}\n\nItems:\n${itemsText}`;
                        // Always send from the books@ alias (SMTP auth can still be info@)
                        const from = 'Purayida Krishi <books@purayidakrishi.com>';
                        await transporter.sendMail({
                            from,
                            to: adminTo,
                            subject: `New order #${created.id}`,
                            text: adminBody,
                            replyTo: 'hello@purayidakrishi.com'
                        });
                    }
                    // Customer confirmation email
                    if (created.email) {
                        const customerText = `Dear ${created.name},\n\nThank you for your order! We have received your order and will process it soon.\n\nOrder Details:\nOrder ID: #${created.id}\nTotal: ${created.total || 'N/A'}\nStatus: ${created.preorder ? 'Pre-order' : 'Processing'}\n\nItems:\n${itemsText}\n\nWe will contact you soon to confirm your order.\n\nBest regards,\nPurayida Krishi Team`;
                        const customerHtml = `
              <div style="font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111827;max-width:600px">
                <h2 style="color:#2d5016">Order Confirmation</h2>
                <p>Dear ${created.name},</p>
                <p>Thank you for your order! We have received your order and will process it soon.</p>
                <div style="background:#f9fafb;padding:16px;border-left:4px solid #2d5016;margin:16px 0">
                  <p style="margin:0 0 8px;font-weight:600">Order Details:</p>
                  <p style="margin:4px 0">Order ID: <strong>#${created.id}</strong></p>
                  <p style="margin:4px 0">Total: <strong>${created.total || 'N/A'}</strong></p>
                  <p style="margin:4px 0">Status: <strong>${created.preorder ? 'Pre-order' : 'Processing'}</strong></p>
                </div>
                <p style="font-weight:600">Items:</p>
                <table style="width:100%;border-collapse:collapse;margin:8px 0">
                  <tr style="background:#f3f4f6"><th style="padding:8px;border:1px solid #ddd;text-align:left">Book</th><th style="padding:8px;border:1px solid #ddd;text-align:left">Quantity</th><th style="padding:8px;border:1px solid #ddd;text-align:left">Price</th></tr>
                  ${itemsHtml}
                </table>
                <p>We will contact you soon to confirm your order.</p>
                <p style="margin-top:16px">Best regards,<br/>Purayida Krishi Team</p>
              </div>`;
                        // Always send from the books@ alias (SMTP auth can still be info@)
                        const from = 'Purayida Krishi <books@purayidakrishi.com>';
                        await transporter.sendMail({
                            from,
                            to: created.email,
                            subject: `Order Confirmation #${created.id}`,
                            text: customerText,
                            html: customerHtml,
                            replyTo: 'hello@purayidakrishi.com'
                        });
                    }
                }
            }
            catch (e) {
                console.error('Order email error', e);
            }
        })();
        res.status(201).json({ id: created.id, preorder: created.preorder, total: created.total });
    }
    catch (err) {
        if (err instanceof z.ZodError)
            return res.status(400).json({ error: 'Invalid payload', details: err.issues });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ===== Public Upload (images only) =====
// Save into the same uploads dir used by static server
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
const imageFilter = (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.mimetype))
        return cb(new Error('Only image uploads are allowed'));
    cb(null, true);
};
const uploadPublic = multer({ storage, fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024 } });
// No auth required; intended for checkout proof image
router.post('/upload-public', uploadPublic.single('file'), (req, res) => {
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
// QR code URL for payments
router.get('/payment/qr', (_req, res) => {
    const url = process.env.PAYMENT_QR_URL || null;
    res.json({ url });
});
// ===== Book Comments =====
const commentsLimiter = rateLimit({ windowMs: 60 * 1000, max: 10 });
const commentCreateSchema = z.object({ name: z.string().min(1).max(120), content: z.string().min(1).max(1000) });
router.get('/books/:id/comments', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
        return res.status(400).json({ error: 'Invalid id' });
    const list = await prisma.bookComment.findMany({ where: { bookId: id, approved: true }, orderBy: { createdAt: 'desc' }, take: 50 });
    res.json(list.map((c) => ({ id: c.id, name: c.name, content: c.content, createdAt: c.createdAt })));
});
router.post('/books/:id/comments', commentsLimiter, async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id))
            return res.status(400).json({ error: 'Invalid id' });
        const parsed = commentCreateSchema.parse(req.body || {});
        const book = await prisma.book.findUnique({ where: { id } });
        if (!book)
            return res.status(404).json({ error: 'Book not found' });
        const created = await prisma.bookComment.create({ data: { bookId: id, name: parsed.name, content: parsed.content } });
        // Send admin notification for book comment (non-blocking)
        (async () => {
            try {
                const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ADMIN_EMAIL } = process.env;
                if (SMTP_HOST && SMTP_PORT) {
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
                    const settings = await prisma.siteSettings.findUnique({ where: { id: 1 } });
                    const adminTo = settings?.bookCommentsEmail || settings?.contactEmail || ADMIN_EMAIL || 'hello@purayidakrishi.com';
                    if (adminTo && !adminTo.includes('example.com')) {
                        const bookTranslation = await prisma.bookTranslation.findFirst({ where: { bookId: id, locale: 'en' } });
                        const bookTitle = bookTranslation?.name || `Book #${id}`;
                        const subject = `New comment on ${bookTitle}`;
                        const text = `New comment on book: ${bookTitle}\nFrom: ${parsed.name}\nBook ID: #${id}\n\nComment:\n${parsed.content}\n\nView book: https://purayidakrishi.com/#/books`;
                        const html = `
              <div style="font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111827">
                <h3 style="color:#2d5016">New Book Comment</h3>
                <p><strong>Book:</strong> ${bookTitle}</p>
                <p><strong>From:</strong> ${parsed.name}</p>
                <p><strong>Book ID:</strong> #${id}</p>
                <div style="background:#f9fafb;padding:16px;border-left:4px solid #2d5016;margin:16px 0">
                  <p style="margin:0 0 8px;font-weight:600">Comment:</p>
                  <p style="margin:0">${parsed.content.replace(/\n/g, '<br>')}</p>
                </div>
                <p><a href="https://purayidakrishi.com/#/books" style="color:#2d5016">View Books</a></p>
              </div>`;
                        const from = SMTP_USER ? `Purayida Krishi <${SMTP_USER}>` : 'books@purayidakrishi.com';
                        await transporter.sendMail({
                            from,
                            to: adminTo,
                            subject,
                            text,
                            html,
                            replyTo: 'hello@purayidakrishi.com'
                        });
                    }
                }
            }
            catch (e) {
                console.error('Book comment email error', e);
            }
        })();
        res.status(201).json({ id: created.id, name: created.name, content: created.content, createdAt: created.createdAt });
    }
    catch (err) {
        if (err instanceof z.ZodError)
            return res.status(400).json({ error: 'Invalid payload', details: err.issues });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ===== Blog Post Comments =====
router.get('/posts/:id/comments', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
        return res.status(400).json({ error: 'Invalid id' });
    const list = await prisma.postComment.findMany({ where: { postId: id, approved: true }, orderBy: { createdAt: 'desc' }, take: 50 });
    res.json(list.map((c) => ({ id: c.id, name: c.name, content: c.content, createdAt: c.createdAt })));
});
const postCommentsLimiter = rateLimit({ windowMs: 60 * 1000, max: 10 });
router.post('/posts/:id/comments', postCommentsLimiter, async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id))
            return res.status(400).json({ error: 'Invalid id' });
        const name = String((req.body?.name || '').toString()).trim();
        const content = String((req.body?.content || '').toString()).trim();
        if (!name || !content)
            return res.status(400).json({ error: 'Missing required fields' });
        if (name.length > 120 || content.length > 1000)
            return res.status(400).json({ error: 'Input too long' });
        const post = await prisma.post.findUnique({ where: { id }, select: { id: true, published: true } });
        if (!post || !post.published)
            return res.status(404).json({ error: 'Post not found' });
        const created = await prisma.postComment.create({ data: { postId: id, name, content, approved: true } });
        // Send admin notification for blog comment (non-blocking)
        (async () => {
            try {
                const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ADMIN_EMAIL } = process.env;
                if (SMTP_HOST && SMTP_PORT) {
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
                    const settings = await prisma.siteSettings.findUnique({ where: { id: 1 } });
                    const adminTo = settings?.blogCommentsEmail || settings?.contactEmail || ADMIN_EMAIL || 'hello@purayidakrishi.com';
                    if (adminTo && !adminTo.includes('example.com')) {
                        const postTranslation = await prisma.postTranslation.findFirst({ where: { postId: id, locale: 'en' } });
                        const postTitle = postTranslation?.title || `Post #${id}`;
                        const subject = `New comment on "${postTitle}"`;
                        const text = `New comment on blog post: ${postTitle}\nFrom: ${name}\nPost ID: #${id}\n\nComment:\n${content}\n\nView post: https://purayidakrishi.com/#/blog`;
                        const html = `
              <div style="font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111827">
                <h3 style="color:#2d5016">New Blog Comment</h3>
                <p><strong>Post:</strong> ${postTitle}</p>
                <p><strong>From:</strong> ${name}</p>
                <p><strong>Post ID:</strong> #${id}</p>
                <div style="background:#f9fafb;padding:16px;border-left:4px solid #2d5016;margin:16px 0">
                  <p style="margin:0 0 8px;font-weight:600">Comment:</p>
                  <p style="margin:0">${content.replace(/\n/g, '<br>')}</p>
                </div>
                <p><a href="https://purayidakrishi.com/#/blog" style="color:#2d5016">View Blog</a></p>
              </div>`;
                        const from = SMTP_USER ? `Purayida Krishi <${SMTP_USER}>` : 'blog@purayidakrishi.com';
                        await transporter.sendMail({
                            from,
                            to: adminTo,
                            subject,
                            text,
                            html,
                            replyTo: 'hello@purayidakrishi.com'
                        });
                    }
                }
            }
            catch (e) {
                console.error('Blog comment email error', e);
            }
        })();
        res.status(201).json({ id: created.id, name: created.name, content: created.content, createdAt: created.createdAt });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /api/settings - Public settings (background images, etc.)
router.get('/settings', async (_req, res) => {
    try {
        let settings = await prisma.siteSettings.findUnique({ where: { id: 1 } });
        if (!settings) {
            // Create default settings if not exists
            settings = await prisma.siteSettings.create({
                data: { id: 1, defaultLocale: 'en' }
            });
        }
        res.json(settings);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
export default router;
