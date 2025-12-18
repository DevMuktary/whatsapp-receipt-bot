import { getDB, ObjectId } from '../db.js';
import * as aiService from '../services/aiService.js';
import * as whatsappService from '../services/whatsappService.js';
import * as receiptService from '../services/receiptService.js';
import * as userService from '../services/userService.js';

const processingUsers = new Set();

export async function processIncomingMessage(msg) {
    const senderId = msg.from;
    const msgType = msg.type;
    let text = '';
    
    if (msgType === 'text') { 
        text = msg.text.body.trim(); 
    } else if (msgType === 'image') { 
        text = msg.image.caption ? msg.image.caption.trim() : 'Image'; 
    } else { 
        return; 
    }

    if (processingUsers.has(senderId)) return;
    processingUsers.add(senderId);

    try {
        const db = getDB();
        let user = await db.collection('users').findOne({ userId: senderId });
        let userSession = await db.collection('conversations').findOne({ userId: senderId });

        // --- 1. NEW USER / ONBOARDING ---
        if (!user) {
            if (text.toLowerCase().startsWith('restore')) {
                await userService.restoreAccount(senderId, text);
            } else {
                await userService.handleOnboarding(senderId, text, userSession);
            }
            return; // Stop here, don't use AI for onboarding yet
        }

        // --- 2. AI INTELLIGENCE ---
        // Grab the data we already know (if user is in the middle of a receipt)
        const currentReceiptData = userSession?.data?.receiptData || {};
        
        // Pass text + context to AI
        const aiResponse = await aiService.analyzeMessage(text, currentReceiptData);
        console.log(`🤖 User: ${senderId} | Intent: ${aiResponse.intent}`);

        // --- 3. EXECUTE ACTIONS ---
        switch (aiResponse.intent) {
            case 'RECEIPT':
                const newData = aiResponse.data;
                const missing = aiResponse.missingFields || [];

                if (missing.length === 0) {
                    // ALL CLEAR -> GENERATE
                    await whatsappService.sendMessage(senderId, "✅ Perfect. Generating your receipt now...");
                    await receiptService.generateAndSend(senderId, user, newData);
                    // Clear the session state
                    await db.collection('conversations').deleteOne({ userId: senderId });
                } else {
                    // STILL MISSING INFO -> SAVE STATE & ASK
                    await db.collection('conversations').updateOne(
                        { userId: senderId },
                        { 
                            $set: { 
                                state: 'ai_receipt_flow', 
                                'data.receiptData': newData 
                            } 
                        },
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

            case 'REJECT':
                // Strict "No Nonsense" reply
                await whatsappService.sendMessage(senderId, aiResponse.reply);
                break;

            case 'CHAT':
            default:
                await whatsappService.sendMessage(senderId, aiResponse.reply);
                break;
        }

    } catch (err) {
        console.error("❌ Controller Error:", err);
        await whatsappService.sendMessage(senderId, "System error. Please try again later.");
    } finally {
        processingUsers.delete(senderId);
    }
}
