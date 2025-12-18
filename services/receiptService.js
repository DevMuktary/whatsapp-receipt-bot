// services/receiptService.js
import puppeteer from 'puppeteer';
import { getDB, ObjectId } from '../db.js';
import * as whatsappService from './whatsappService.js';

const RECEIPT_BASE_URL = process.env.RECEIPT_BASE_URL;

// Helper to flatten AI object structure to legacy arrays
function flattenData(aiData) {
    const items = [];
    const prices = [];
    if (aiData.items && Array.isArray(aiData.items)) {
        aiData.items.forEach(item => {
            const qty = item.quantity || 1;
            for (let i = 0; i < qty; i++) {
                items.push(item.name);
                prices.push(item.price.toString());
            }
        });
    }
    return { ...aiData, items, prices };
}

export async function generateAndSend(userId, user, aiData) {
    const db = getDB();
    const data = flattenData(aiData);
    const subtotal = data.prices.reduce((a, b) => a + parseFloat(b || 0), 0);

    // Save to DB
    const receiptDoc = {
        userId,
        createdAt: new Date(),
        customerName: data.customerName,
        totalAmount: subtotal,
        items: data.items,
        prices: data.prices,
        paymentMethod: data.paymentMethod,
        editCount: 0
    };
    const result = await db.collection('receipts').insertOne(receiptDoc);
    await db.collection('users').updateOne({ userId }, { $inc: { receiptCount: 1 } });

    // Generate URL
    const urlParams = new URLSearchParams({
        bn: user.brandName,
        bc: user.brandColor,
        logo: user.logoUrl || '',
        cn: data.customerName,
        items: data.items.join('||'),
        prices: data.prices.join(','),
        pm: data.paymentMethod,
        addr: user.address || '',
        ciPhone: user.contactPhone || '',
        rid: result.insertedId.toString()
    });

    const fullUrl = `${RECEIPT_BASE_URL}template.${user.preferredTemplate || 1}.html?${urlParams.toString()}`;

    // Puppeteer
    let browser;
    try {
        browser = await puppeteer.launch({ 
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
        const page = await browser.newPage();
        await page.goto(fullUrl, { waitUntil: 'networkidle0', timeout: 60000 });

        const format = user.receiptFormat || 'PNG';
        const caption = `Here is the receipt for ${data.customerName}.`;

        if (format === 'PDF') {
            const buffer = await page.pdf({ printBackground: true, width: '800px' });
            await whatsappService.sendMedia(userId, buffer, 'application/pdf', caption, `Receipt_${data.customerName}.pdf`);
        } else {
            await page.setViewport({ width: 800, height: 10, deviceScaleFactor: 2 });
            const buffer = await page.screenshot({ fullPage: true, type: 'png' });
            await whatsappService.sendMedia(userId, buffer, 'image/png', caption);
        }
    } catch (err) {
        console.error("Puppeteer Error:", err);
        throw err;
    } finally {
        if (browser) await browser.close();
    }
}

export async function sendHistory(userId) {
    const db = getDB();
    const receipts = await db.collection('receipts').find({ userId }).sort({ createdAt: -1 }).limit(5).toArray();
    
    if (receipts.length === 0) {
        return whatsappService.sendMessage(userId, "You haven't created any receipts yet.");
    }

    let msg = "🧾 *Recent Receipts:*\n\n";
    receipts.forEach((r, i) => {
        msg += `*${i + 1}.* ${r.customerName} - ₦${r.totalAmount.toLocaleString()}\n`;
    });
    await whatsappService.sendMessage(userId, msg);
}

export async function sendStats(userId) {
    const db = getDB();
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    
    const count = await db.collection('receipts').countDocuments({ userId, createdAt: { $gte: startOfMonth } });
    await whatsappService.sendMessage(userId, `📊 *This Month's Stats*\n\nReceipts Generated: ${count}`);
}
