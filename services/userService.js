// services/userService.js
import { getDB, ObjectId } from '../db.js';
import * as whatsappService from './whatsappService.js';

export async function restoreAccount(senderId, text) {
    const db = getDB();
    const code = text.split(' ')[1];
    if (!code) { 
        return whatsappService.sendMessage(senderId, "Please provide a backup code. Example: `restore A1B2C3D4`"); 
    }
    
    const userToRestore = await db.collection('users').findOne({ backupCode: code.toUpperCase() });
    if (!userToRestore) { 
        return whatsappService.sendMessage(senderId, "❌ Invalid backup code."); 
    }
    
    // Update the old user document with the new WhatsApp ID
    await db.collection('users').updateOne({ _id: new ObjectId(userToRestore._id) }, { $set: { userId: senderId } });
    await whatsappService.sendMessage(senderId, `✅ *Account Restored!* Welcome back, ${userToRestore.brandName}.`);
}

export async function handleOnboarding(senderId, text, userSession) {
    const db = getDB();

    if (!userSession) {
        // Start Onboarding
        await db.collection('conversations').insertOne({ userId: senderId, state: 'onboarding_brandName', data: {} });
        await whatsappService.sendMessage(senderId, "👋 Welcome! Let's set up your brand. What is your *Business Name*?");
        return;
    }

    const state = userSession.state;

    if (state === 'onboarding_brandName') {
        await db.collection('users').insertOne({ 
            userId: senderId, 
            brandName: text, 
            receiptCount: 0, 
            isPaid: false, 
            createdAt: new Date() 
        });
        await db.collection('conversations').updateOne({ userId: senderId }, { $set: { state: 'onboarding_color' } });
        await whatsappService.sendMessage(senderId, "Great! What is your *Brand Color*? (e.g. Blue, #FF0000)");
    } 
    else if (state === 'onboarding_color') {
        await db.collection('users').updateOne({ userId: senderId }, { $set: { brandColor: text } });
        // Simplified: Mark done
        await db.collection('conversations').deleteOne({ userId: senderId });
        await whatsappService.sendMessage(senderId, "✅ *Setup Complete!*\n\nYou can now generate receipts instantly. Try saying:\n\n_\"Receipt for Mr. John, 2 shoes at 5000 each, paid by Transfer\"_");
    }
}
