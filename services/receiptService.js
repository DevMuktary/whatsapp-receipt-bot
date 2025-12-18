// services/receiptService.js
import puppeteer from 'puppeteer';
import { getDB, ObjectId } from '../db.js';
import * as whatsappService from './whatsappService.js';

const RECEIPT_BASE_URL = process.env.RECEIPT_BASE_URL;

/**
 * Consolidates items for the receipt template.
 * Instead of listing "Rice" twice, it formats it as "Rice (x2)" with the total price.
 */
function consolidateDataForTemplate(aiData) {
    const templateItems = [];
    const templatePrices = [];
    
    // For Database: We keep the structured data
    // For Template: We merge lines
    if (aiData.items && Array.isArray(aiData.items)) {
        aiData.items.forEach(item => {
            const qty = parseInt(item.quantity) || 1;
            const unitPrice = parseFloat(item.price) || 0;
            const lineTotal = unitPrice * qty;

            // Format Name: "Rice" or "Rice (x2)"
            const nameDisplay = qty > 1 ? `${item.name} (x${qty})` : item.name;

            templateItems.push(nameDisplay);
            templatePrices.push(lineTotal.toString());
        });
    }

    return { 
        ...aiData, 
        items: templateItems, 
        prices: templatePrices 
    };
}

export async function generateAndSend(userId, user, aiData) {
    const db = getDB();
    
    // 1. Prepare Data for the HTML Template (Visuals)
    const visualData = consolidateDataForTemplate(aiData);
    
    // Calculate total from the consolidated prices
    const totalAmount = visualData.prices.reduce((sum, p) => sum + parseFloat(p), 0);

    // 2. Save original structured data to DB (better for stats/inventory later)
    const receiptDoc = {
        userId,
        createdAt: new Date(),
        customerName: aiData.customerName,
        totalAmount: totalAmount,
        items: aiData.items, // Save the raw objects {name, qty, price}
        paymentMethod: aiData.paymentMethod,
        editCount: 0
    };
    
    const result = await db.collection('receipts').insertOne(receiptDoc);
    await db.collection('users').updateOne({ userId }, { $inc: { receiptCount: 1 } });

    // 3. Generate URL using the Visual Data
    const urlParams = new URLSearchParams({
        bn: user.brandName,
        bc: user.brandColor,
        logo: user.logoUrl || '',
        cn: visualData.customerName,
        items: visualData.items.join('||'),   // "Rice (x2)||Beans"
        prices: visualData.prices.join(','),  // "6000,4000"
        pm: visualData.paymentMethod,
        rid: result.insertedId.toString()
    });

    const fullUrl = `${RECEIPT_BASE_URL}template.${user.preferredTemplate || 1}.html?${urlParams.toString()}`;

    // 4. Puppeteer Generation
    let browser;
    try {
        browser = await puppeteer.launch({ 
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
        const page = await browser.newPage();
        await page.goto(fullUrl, { waitUntil: 'networkidle0', timeout: 60000 });

        const caption = `Here is the receipt for ${aiData.customerName}.`;
        
        if (user.receiptFormat === 'PDF') {
            const buffer = await page.pdf({ printBackground: true, width: '800px' });
            await whatsappService.sendMedia(userId, buffer, 'application/pdf', caption, `Receipt_${aiData.customerName}.pdf`);
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
    if (receipts.length === 0) return whatsappService.sendMessage(userId, "No receipts found.");

    let msg = "🧾 *Recent Receipts:*\n";
    receipts.forEach((r, i) => msg += `*${i+1}.* ${r.customerName} - ₦${r.totalAmount.toLocaleString()}\n`);
    await whatsappService.sendMessage(userId, msg);
}

export async function sendStats(userId) {
    const db = getDB();
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    const count = await db.collection('receipts').countDocuments({ userId, createdAt: { $gte: startOfMonth } });
    await whatsappService.sendMessage(userId, `📊 *Monthly Stats*\nReceipts: ${count}`);
}
