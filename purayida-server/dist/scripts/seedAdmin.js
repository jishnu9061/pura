import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma.js';
function slugify(input) {
    return input
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');
}
async function main() {
    const email = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
    const password = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!';
    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing) {
        const hash = await bcrypt.hash(password, 10);
        await prisma.user.create({ data: { email, password: hash, role: 'ADMIN' } });
        console.log(`Seeded ADMIN user: ${email}`);
    }
    else {
        console.log(`ADMIN user already exists: ${email}`);
    }
    // Ensure singletons exist
    await prisma.siteSettings.upsert({
        where: { id: 1 },
        update: {},
        create: { id: 1, defaultLocale: 'en', contactEmail: 'hello@example.com' },
    });
    await prisma.aboutPage.upsert({
        where: { id: 1 },
        update: {},
        create: { id: 1 },
    });
    // Minimal EN translation
    const aboutEn = await prisma.aboutPageTranslation.findUnique({
        where: { aboutId_locale: { aboutId: 1, locale: 'en' } },
    });
    if (!aboutEn) {
        await prisma.aboutPageTranslation.create({
            data: {
                aboutId: 1,
                locale: 'en',
                heading: 'About Purayidakrishi',
                body: 'Edit this content via admin API.',
                points: JSON.stringify([
                    'Point one',
                    'Point two',
                ]),
            },
        });
    }
    await prisma.contactPage.upsert({
        where: { id: 1 },
        update: { email: 'hello@purayidakrishi.com' },
        create: { id: 1, email: 'hello@purayidakrishi.com' },
    });
    const contactEn = await prisma.contactPageTranslation.findUnique({
        where: { contactId_locale: { contactId: 1, locale: 'en' } },
    });
    if (!contactEn) {
        await prisma.contactPageTranslation.create({
            data: {
                contactId: 1,
                locale: 'en',
                heading: 'Get in Touch',
                sub: 'Tell us about your space and goals.',
            },
        });
    }
    // Malayalam translations for single types
    const aboutMl = await prisma.aboutPageTranslation.findUnique({
        where: { aboutId_locale: { aboutId: 1, locale: 'ml' } },
    });
    if (!aboutMl) {
        await prisma.aboutPageTranslation.create({
            data: {
                aboutId: 1,
                locale: 'ml',
                heading: 'പുരയിടകൃഷിയെ കുറിച്ച്',
                body: 'അഡ്മിന് വഴി ഈ ഉള്ളടക്കം മാറ്റാം.',
                points: JSON.stringify([
                    'മണ്ണ് ആദ്യം',
                    'നാട്ടുവിത്തുകള്‍',
                ]),
            },
        });
    }
    const contactMl = await prisma.contactPageTranslation.findUnique({
        where: { contactId_locale: { contactId: 1, locale: 'ml' } },
    });
    if (!contactMl) {
        await prisma.contactPageTranslation.create({
            data: {
                contactId: 1,
                locale: 'ml',
                heading: 'ബന്ധപ്പെടുക',
                sub: 'നിങ്ങളുടെ സ്ഥലവും ലക്ഷ്യങ്ങളും പറയൂ.',
            },
        });
    }
    // ServicesPage single-type
    await prisma.servicesPage.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    const spEn = await prisma.servicesPageTranslation.findUnique({ where: { servicesPageId_locale: { servicesPageId: 1, locale: 'en' } } });
    if (!spEn) {
        await prisma.servicesPageTranslation.create({ data: { servicesPageId: 1, locale: 'en', heading: 'Our Services', sub: 'Agroecology education, training and consultation' } });
    }
    const spMl = await prisma.servicesPageTranslation.findUnique({ where: { servicesPageId_locale: { servicesPageId: 1, locale: 'ml' } } });
    if (!spMl) {
        await prisma.servicesPageTranslation.create({ data: { servicesPageId: 1, locale: 'ml', heading: 'ഞങ്ങളുടെ സേവനങ്ങൾ', sub: 'കാർഷിക വിദ്യാഭ്യാസവും കൺസൾട്ടേഷനും' } });
    }
    // Seed Categories (with translations)
    const categories = [
        { slug: 'farming', en: 'Farming', ml: 'കൃഷി' },
        { slug: 'organic', en: 'Organic', ml: 'ജൈവിക' },
        { slug: 'soil-health', en: 'Soil Health', ml: 'മണ്ണിന്റെ ആരോഗ്യം' },
        { slug: 'water', en: 'Water Management', ml: 'ജല പരിപാലനം' },
        { slug: 'biodiversity', en: 'Biodiversity', ml: 'ജൈവവൈവിധ്യം' },
    ];
    for (const c of categories) {
        const cat = await prisma.category.upsert({
            where: { slug: c.slug },
            update: {},
            create: { slug: c.slug },
        });
        for (const [locale, name] of [
            ['en', c.en],
            ['ml', c.ml],
        ]) {
            const exists = await prisma.categoryTranslation.findUnique({
                where: { categoryId_locale: { categoryId: cat.id, locale } },
            });
            if (!exists) {
                await prisma.categoryTranslation.create({
                    data: { categoryId: cat.id, locale, name },
                });
            }
        }
    }
    // Seed Posts (two normal + one ad), with translations and published
    async function ensurePost(slugs, data) {
        const existingEn = await prisma.postTranslation.findUnique({
            where: { slug_locale: { slug: slugs.en, locale: 'en' } },
        });
        if (existingEn)
            return; // already seeded
        const categoryId = data.categorySlug
            ? (await prisma.category.findUnique({ where: { slug: data.categorySlug } }))?.id
            : undefined;
        const created = await prisma.post.create({
            data: {
                date: data.date || new Date(),
                imageUrl: data.imageUrl,
                isAd: !!data.isAd,
                ctaUrl: data.ctaUrl || null,
                categoryId,
                published: true,
                reviewStatus: 'approved',
                translations: {
                    create: [
                        {
                            locale: 'en',
                            title: data.en.title,
                            excerpt: data.en.excerpt,
                            content: data.en.content,
                            adText: data.en.adText || undefined,
                            ctaText: data.en.ctaText || undefined,
                            slug: slugs.en,
                        },
                        {
                            locale: 'ml',
                            title: data.ml.title,
                            excerpt: data.ml.excerpt,
                            content: data.ml.content,
                            adText: data.ml.adText || undefined,
                            ctaText: data.ml.ctaText || undefined,
                            slug: slugs.ml,
                        },
                    ],
                },
            },
        });
        console.log('Seeded post', created.id, slugs.en);
    }
    await ensurePost({ en: 'sustainable-homestead-design', ml: 'sustainable-homestead-design-ml' }, {
        categorySlug: 'farming',
        imageUrl: 'https://images.unsplash.com/photo-1574943320219-553eb213f72d?w=800&h=500&fit=crop&auto=format',
        en: {
            title: 'Sustainable Homestead Design',
            excerpt: 'Designing a homestead that works with nature.',
            content: 'Long-form content...'
        },
        ml: {
            title: 'സ്ഥിരതയുള്ള ഹോംസ്റ്റഡ് ഡിസൈൻ',
            excerpt: 'പ്രകൃതിയോട് യോജിച്ച് ഹോംസ്റ്റഡ് രൂപകൽപ്പന.',
            content: 'ദീർഘമായ ഉള്ളടക്കം...'
        },
    });
    await ensurePost({ en: 'water-conservation-in-agriculture', ml: 'water-conservation-in-agriculture-ml' }, {
        categorySlug: 'water',
        imageUrl: 'https://images.unsplash.com/photo-1625246333195-78d9c38ad449?w=800&h=500&fit=crop&auto=format',
        en: {
            title: 'Water Conservation in Agriculture',
            excerpt: 'Strategies to conserve water effectively.',
        },
        ml: {
            title: 'കൃഷിയിൽ ജല സംരക്ഷണം',
            excerpt: 'ജലം സംരക്ഷിക്കുന്ന തന്ത്രങ്ങൾ.',
        },
    });
    await ensurePost({ en: 'premium-agricultural-tools', ml: 'premium-agricultural-tools-ml' }, {
        isAd: true,
        ctaUrl: 'https://example.com/tools',
        imageUrl: 'https://images.unsplash.com/photo-1523348837708-15d4a09cfac2?w=800&h=500&fit=crop&auto=format',
        en: {
            title: 'Premium Agricultural Tools',
            excerpt: 'Quality tools that last a lifetime.',
            adText: 'Sponsored',
            ctaText: 'Shop Now',
        },
        ml: {
            title: 'പ്രീമിയം കാർഷിക ഉപകരണങ്ങൾ',
            excerpt: 'ജീവിതകാലം മുഴുവൻ നിലനിൽക്കുന്ന ഉപകരണങ്ങൾ.',
            adText: 'സ്പോൺസർ ചെയ്തത്',
            ctaText: 'ഇപ്പോൾ വാങ്ങുക',
        },
    });
    // Seed Services (ordered)
    const serviceSeeds = [
        { order: 1, link: '/online-courses', en: { title: 'Online Courses', description: 'Interactive courses', details: 'Video + resources' }, ml: { title: 'ഓൺലൈൻ കോഴ്സുകൾ', description: 'ഇന്ററാക്ടീവ് കോഴ്സുകൾ', details: 'വീഡിയോ + റിസോഴ്സുകൾ' } },
        { order: 2, link: '/workshops', en: { title: 'Workshops & Speeches', description: 'In-person and virtual', details: 'Hands-on sessions' }, ml: { title: 'വർക്ക്ഷോപ്പുകൾ & പ്രഭാഷണങ്ങൾ', description: 'പ്രായോഗികവും വെർച്വൽ', details: 'ഹാൻഡ്സ്-ഓൺ സെഷനുകൾ' } },
        { order: 3, link: '/consultancy', en: { title: 'Project Consultancy', description: 'Professional consultation', details: 'Planning and strategy' }, ml: { title: 'പ്രോജക്റ്റ് കൺസൾട്ടൻസി', description: 'പ്രൊഫഷണൽ കൺസൾട്ടേഷൻ', details: 'പ്ലാനിംഗ് & സ്റ്റ്രാറ്റജി' } },
        { order: 4, link: '/farm-visits', en: { title: 'Farm Visits', description: 'Guided educational tours', details: 'Experience sustainable farming' }, ml: { title: 'ഫാം സന്ദർശനങ്ങൾ', description: 'മാർഗനിർദേശ ടൂറുകൾ', details: 'സുസ്ഥിര കൃഷി അനുഭവം' } },
        { order: 5, link: '/soil-testing', en: { title: 'Soil Testing', description: 'Analyze soil health and nutrients', details: 'Testing + recommendations' }, ml: { title: 'മണ്ണ് പരിശോധന', description: 'മണ്ണിന്റെ ആരോഗ്യവും പോഷകങ്ങളും', details: 'പരിശോധനയും നിർദേശങ്ങളും' } },
        { order: 6, link: '/home-garden-setup', en: { title: 'Home Garden Setup', description: 'Design and set up home gardens', details: 'Layout, planting plan, schedule' }, ml: { title: 'ഹോം ഗാർഡൻ ക്രമീകരണം', description: 'ഹോം ഗാർഡൻ ഡിസൈൻ & ക്രമീകരണം', details: 'ലേഔട്ട്, നടീൽ പ്ലാൻ, ഷെഡ്യൂൾ' } },
    ];
    for (const s of serviceSeeds) {
        const existing = await prisma.service.findFirst({ where: { translations: { some: { locale: 'en', title: s.en.title } } } });
        if (!existing) {
            await prisma.service.create({
                data: {
                    link: s.link,
                    order: s.order,
                    translations: {
                        create: [
                            { locale: 'en', title: s.en.title, description: s.en.description, details: s.en.details, slug: slugify(s.en.title) },
                            { locale: 'ml', title: s.ml.title, description: s.ml.description, details: s.ml.details, slug: slugify(s.ml.title) },
                        ],
                    },
                },
            });
        }
    }
    // Seed Gallery images
    const gallerySeeds = [
        {
            imageUrl: 'https://images.unsplash.com/photo-1501004318641-b39e6451bec6?q=80&w=800&auto=format&fit=crop',
            order: 1,
            en: { caption: 'Organic Vegetable Garden', description: 'Fresh organic vegetables.' },
            ml: { caption: 'ജൈവ പച്ചക്കറി തോട്ടം', description: 'ജൈവ പച്ചക്കറികൾ.' },
        },
        {
            imageUrl: 'https://images.unsplash.com/photo-1492496913980-501348b61469?q=80&w=800&auto=format&fit=crop',
            order: 2,
            en: { caption: 'Traditional Farming Methods', description: 'Time-tested practices.' },
            ml: { caption: 'പരമ്പരാഗത കൃഷി രീതികൾ', description: 'പരീക്ഷിച്ച രീതികൾ.' },
        },
        {
            imageUrl: 'https://images.unsplash.com/photo-1461354464878-ad92f492a5a0?q=80&w=800&auto=format&fit=crop',
            order: 3,
            en: { caption: 'Sustainable Agriculture', description: 'Environment-friendly farming.' },
            ml: { caption: 'സുസ്ഥിര കൃഷി', description: 'പരിസ്ഥിതി സൗഹൃദ കൃഷി.' },
        },
        {
            imageUrl: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?q=80&w=800&auto=format&fit=crop',
            order: 4,
            en: { caption: 'Forest Conservation', description: 'Preserving ecosystems.' },
            ml: { caption: 'വന സംരക്ഷണം', description: 'ആവാസവ്യവസ്ഥ സംരക്ഷണം.' },
        },
        {
            imageUrl: 'https://images.unsplash.com/photo-1530836369250-ef72a3f5cda8?q=80&w=800&auto=format&fit=crop',
            order: 5,
            en: { caption: 'Natural Fertilizers', description: 'Soil amendments and compost.' },
            ml: { caption: 'പ്രകൃതിദത്ത വളങ്ങൾ', description: 'മണ്ണ് പുഷ്ടികരിക്കുന്ന മാർഗ്ഗങ്ങൾ.' },
        },
    ];
    for (const g of gallerySeeds) {
        const existing = await prisma.galleryImage.findFirst({ where: { imageUrl: g.imageUrl } });
        if (!existing) {
            await prisma.galleryImage.create({
                data: {
                    imageUrl: g.imageUrl,
                    order: g.order,
                    translations: {
                        create: [
                            { locale: 'en', caption: g.en.caption, description: g.en.description },
                            { locale: 'ml', caption: g.ml.caption, description: g.ml.description },
                        ],
                    },
                },
            });
        }
    }
    console.log('Seed complete.');
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
