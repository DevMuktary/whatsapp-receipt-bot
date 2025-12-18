// controllers/messageController.js
import { getDB } from '../db.js';
import * as aiService from '../services/aiService.js';
import * as whatsappService from '../services/whatsappService.js';
import * as receiptService from '../services/receiptService.js';
import * as userService from '../services/userService.js';
import * as menuService from '../services/menuService.js'; // <--- Import Menu Service

const processingUsers = new Set();

export async function processIncomingMessage(msg) {
    const senderId = msg.from;
    const msgType = msg.type;
    let text = '';
    
    // --- 1. EXTRACT TEXT FROM DIFFERENT MESSAGE TYPES ---
    if (msgType === 'text') { 
        text = msg.text.body.trim(); 
    } 
    else if (msgType === 'interactive') {
        // Handle Menu Clicks (Buttons or Lists)
        const interactive = msg.interactive;
        if (interactive.type === 'button_reply') {
            text = interactive.button_reply.id; // Get the ID (e.g., CMD_RECEIPT)
        } else if (interactive.type === 'list_reply') {
            text = interactive.list_reply.id;
        }
    }
    else if (msgType === 'image') { 
        text = msg.image.caption ? msg.image.caption.trim() : 'Image'; 
    } 
    else { 
        return; 
    }

    if (processingUsers.has(senderId)) return;
    processingUsers.add(senderId);

    try {
        const db = getDB();
        let user = await db.collection('users').findOne({ userId: senderId });
        let userSession = await db.collection('conversations').findOne({ userId: senderId });

        // --- 2. HANDLE "AI" or "MENU" TRIGGER ---
        // If user says "Ai", "Menu", or "Cmd_menu" (from button), send the list
        if (['ai', 'menu', 'help', 'cmd_menu'].includes(text.toLowerCase())) {
            await menuService.sendMainMenu(senderId);
            processingUsers.delete(senderId);
            return;
        }

        // --- 3. ONBOARDING CHECK ---
        if (!user) {
            if (text.toLowerCase().startsWith('restore')) {
                await userService.restoreAccount(senderId, text);
            } else {
                await userService.handleOnboarding(senderId, text, userSession);
            }
            return;
        }

        // --- 4. MAP MENU COMMANDS TO AI INTENTS ---
        // We force specific text if a button ID was clicked, so the AI knows exactly what to do
        let aiInputText = text;
        
        if (text === 'CMD_RECEIPT') aiInputText = "I want to create a new receipt";
        else if (text === 'CMD_HISTORY') aiInputText = "Show me my receipt history";
        else if (text === 'CMD_STATS') aiInputText = "Show me my sales stats";
        else if (text === 'CMD_MYBRAND') aiInputText = "Update my brand";
        else if (text === 'CMD_SUPPORT') aiInputText = "I need support";

        // --- 5. AI PROCESSING ---
        const currentReceiptData = userSession?.data?.receiptData || {};
        
        const aiResponse = await aiService.analyzeMessage(aiInputText, currentReceiptData);
        console.log(`🤖 Intent: ${aiResponse.intent} | Input: ${aiInputText}`);

        switch (aiResponse.intent) {
            case 'RECEIPT':
                const newData = aiResponse.data;
                const missing = aiResponse.missingFields || [];

                if (missing.length === 0) {
                    await whatsappService.sendMessage(senderId, "✅ Perfect. Generating your receipt now...");
                    await receiptService.generateAndSend(senderId, user, newData);
                    await db.collection('conversations').deleteOne({ userId: senderId });
                } else {
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
                // Send post-task menu
                await menuService.sendPostTaskMenu(senderId, "Done. Anything else?");
                break;

            case 'STATS':
                await receiptService.sendStats(senderId);
                await menuService.sendPostTaskMenu(senderId, "Done. Anything else?");
                break;

            case 'CANCEL':
                await db.collection('conversations').deleteOne({ userId: senderId });
                await whatsappService.sendMessage(senderId, "🚫 Action cancelled.");
                await menuService.sendMainMenu(senderId); // Back to main menu
                break;

            case 'REJECT':
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
