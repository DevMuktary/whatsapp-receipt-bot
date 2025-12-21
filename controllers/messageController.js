import { getDB } from '../db.js';
import * as aiService from '../services/aiService.js';
import * as whatsappService from '../services/whatsappService.js';
import * as receiptService from '../services/receiptService.js';
import * as userService from '../services/userService.js';
import * as menuService from '../services/menuService.js';

// Prevent double-processing of messages from the same user
const processingUsers = new Set();

export async function processIncomingMessage(msg) {
    const senderId = msg.from;
    const msgType = msg.type;
    let text = '';
    
    // --- 1. EXTRACT TEXT BASED ON MESSAGE TYPE ---
    if (msgType === 'text') { 
        text = msg.text.body.trim(); 
    } 
    else if (msgType === 'interactive') {
        // Handle Button Clicks and List Selections
        const interactive = msg.interactive;
        if (interactive.type === 'button_reply') {
            text = interactive.button_reply.id; 
        } else if (interactive.type === 'list_reply') {
            text = interactive.list_reply.id;
        }
    }
    else if (msgType === 'image') { 
        // If it's an image, use the caption as text (or default to "Image")
        text = msg.image.caption ? msg.image.caption.trim() : 'Image'; 
    } 
    else { 
        // Ignore other message types (audio, sticker, etc.)
        return; 
    }

    // --- 2. CONCURRENCY LOCK ---
    if (processingUsers.has(senderId)) return;
    processingUsers.add(senderId);

    try {
        const db = getDB();
        
        // Fetch User and Session in parallel for speed
        const [user, userSession] = await Promise.all([
            db.collection('users').findOne({ userId: senderId }),
            db.collection('conversations').findOne({ userId: senderId })
        ]);

        // --- 3. GLOBAL COMMANDS (MENU / HELP) ---
        // These override everything else.
        const lowerText = text.toLowerCase();
        if (['ai', 'menu', 'help', 'cmd_menu', 'hi', 'hello'].includes(lowerText)) {
            // If the user says "Hi" but is NOT onboarded, let them fall through to onboarding.
            // If they ARE onboarded, show the menu.
            if (user) {
                await menuService.sendMainMenu(senderId);
                processingUsers.delete(senderId);
                return;
            }
        }

        // --- 4. ONBOARDING & RESTORE FLOW ---
        if (!user) {
            if (lowerText.startsWith('restore')) {
                await userService.restoreAccount(senderId, text);
            } else {
                await userService.handleOnboarding(senderId, text, userSession);
            }
            // Stop here; don't use AI until registered
            processingUsers.delete(senderId);
            return;
        }

        // --- 5. PREPARE INPUT FOR AI ---
        // Convert Button IDs (e.g. "CMD_STATS") into natural language for the AI
        let aiInputText = text;
        if (text === 'CMD_RECEIPT') aiInputText = "New Receipt";
        else if (text === 'CMD_HISTORY') aiInputText = "History";
        else if (text === 'CMD_STATS') aiInputText = "Stats";
        else if (text === 'CMD_MYBRAND') aiInputText = "My Brand";
        else if (text === 'CMD_SUPPORT') aiInputText = "Support";

        // --- 6. AI ANALYSIS ---
        const currentReceiptData = userSession?.data?.receiptData || {};
        
        // The AI Service now returns the strict 'missingFields' array
        const aiResponse = await aiService.analyzeMessage(aiInputText, currentReceiptData);
        
        console.log(`🤖 Intent: ${aiResponse.intent} | Missing: ${aiResponse.missingFields?.length || 0}`);

        // --- 7. ACTION HANDLER ---
        switch (aiResponse.intent) {
            case 'RECEIPT':
                const missing = aiResponse.missingFields || [];

                if (missing.length === 0) {
                    // ALL DATA PRESENT -> GENERATE
                    await whatsappService.sendMessage(senderId, "✅ Data complete. Generating receipt...");
                    
                    // Generate PDF/Image and send it
                    await receiptService.generateAndSend(senderId, user, aiResponse.data);
                    
                    // Clear the session (Receipt is done)
                    await db.collection('conversations').deleteOne({ userId: senderId });
                } else {
                    // MISSING DATA -> SAVE STATE & ASK USER
                    // We save the updated data back to the DB so the context grows
                    await db.collection('conversations').updateOne(
                        { userId: senderId },
                        { 
                            $set: { 
                                state: 'ai_receipt_flow', 
                                'data.receiptData': aiResponse.data 
                            } 
                        },
                        { upsert: true }
                    );
                    
                    // Send the AI's specific question (e.g., "Enter Items")
                    await whatsappService.sendMessage(senderId, aiResponse.reply);
                }
                break;

            case 'CANCEL':
                // User said "Cancel" or "Reset"
                await db.collection('conversations').deleteOne({ userId: senderId });
                await whatsappService.sendMessage(senderId, aiResponse.reply); // "🚫 Receipt cancelled."
                // Send Main Menu immediately so they aren't lost
                await menuService.sendMainMenu(senderId);
                break;

            case 'HISTORY':
                await receiptService.sendHistory(senderId);
                await menuService.sendPostTaskMenu(senderId, "History shown. What's next?");
                break;

            case 'STATS':
                await receiptService.sendStats(senderId);
                await menuService.sendPostTaskMenu(senderId, "Stats shown. What's next?");
                break;

            case 'REJECT':
                // User said something off-topic while in the middle of a flow
                await whatsappService.sendMessage(senderId, aiResponse.reply);
                break;

            case 'CHAT':
            default:
                // General chatter or specific instructions from AI
                await whatsappService.sendMessage(senderId, aiResponse.reply);
                break;
        }

    } catch (err) {
        console.error("❌ Controller Error:", err);
        await whatsappService.sendMessage(senderId, "System error. Please try again.");
    } finally {
        // Always release the lock
        processingUsers.delete(senderId);
    }
}
