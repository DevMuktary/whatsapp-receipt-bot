// controllers/messageController.js
import { getDB, ObjectId } from '../db.js';
import * as aiService from '../services/aiService.js';
import * as whatsappService from '../services/whatsappService.js';
import * as receiptService from '../services/receiptService.js';
import * as userService from '../services/userService.js';

// Prevent double-processing
const processingUsers = new Set();

export async function processIncomingMessage(msg) {
    const senderId = msg.from;
    const msgType = msg.type;
    let text = '';
    
    // Extract text from message
    if (msgType === 'text') { 
        text = msg.text.body.trim(); 
    } else if (msgType === 'image') { 
        text = msg.image.caption ? msg.image.caption.trim() : 'Image'; 
        // Note: You can pass msg.image.id to AI if you want it to see the image later
    } else { 
        return; 
    }

    if (processingUsers.has(senderId)) return;
    processingUsers.add(senderId);

    try {
        const db = getDB();
        let user = await db.collection('users').findOne({ userId: senderId });
        let userSession = await db.collection('conversations').findOne({ userId: senderId });

        // --- STEP 1: RESTORE OR ONBOARDING ---
        if (!user) {
            // Check for Restore Command
            if (text.toLowerCase().startsWith('restore')) {
                await userService.restoreAccount(senderId, text);
            } 
            // Handle New User Onboarding
            else {
                await userService.handleOnboarding(senderId, text, userSession);
            }
            return;
        }

        // --- STEP 2: AI PROCESSING ---
        // Get current context (if they are building a receipt)
        const currentReceiptData = userSession?.data?.receiptData || {};
        
        // Ask OpenAI
        const aiResponse = await aiService.analyzeMessage(text, currentReceiptData);
        console.log(`🤖 AI Intent: ${aiResponse.intent} | User: ${senderId}`);

        // --- STEP 3: EXECUTE INTENT ---
        switch (aiResponse.intent) {
            case 'RECEIPT':
                const newData = aiResponse.data;
                const missing = aiResponse.missingFields || [];

                if (missing.length === 0) {
                    // Success! Generate Receipt
                    await whatsappService.sendMessage(senderId, "✅ details received. Generating receipt...");
                    await receiptService.generateAndSend(senderId, user, newData);
                    // Clear session
                    await db.collection('conversations').deleteOne({ userId: senderId });
                } else {
                    // Ask for missing info
                    await db.collection('conversations').updateOne(
                        { userId: senderId },
                        { $set: { state: 'ai_receipt_flow', 'data.receiptData': newData } },
                        { upsert: true }
                    );
                    await whatsappService.sendMessage(senderId, aiResponse.reply);
                }
                break;

            case 'HISTORY':
                await receiptService.sendHistory(senderId);
                break;

            case 'STATS':
                await receiptService.sendStats(senderId);
                break;

            case 'CANCEL':
                await db.collection('conversations').deleteOne({ userId: senderId });
                await whatsappService.sendMessage(senderId, "🚫 Action cancelled.");
                break;

            case 'MYBRAND':
                await whatsappService.sendMessage(senderId, "To update your brand settings, please contact support or use the web dashboard (Coming Soon).");
                break;

            case 'CHAT':
            default:
                await whatsappService.sendMessage(senderId, aiResponse.reply);
                break;
        }

    } catch (err) {
        console.error("❌ Error in controller:", err);
        await whatsappService.sendMessage(senderId, "Sorry, I encountered a temporary error. Please try again.");
    } finally {
        processingUsers.delete(senderId);
    }
}
