// aiService.js
import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Analyzes the user's message to determine intent and extract receipt data.
 * @param {string} text - The user's message.
 * @param {object} currentContext - The current receipt data (if any) stored in the DB.
 * @returns {Promise<object>} - structured data containing intent, entities, and a reply.
 */
export async function analyzeMessage(text, currentContext = {}) {
    const currentDate = new Date().toLocaleDateString('en-NG');
    
    // Construct a context summary to help the AI understand what we already know
    const contextDescription = JSON.stringify(currentContext || {});

    const systemPrompt = `
    You are the intelligent brain of a WhatsApp Receipt Bot for a Nigerian business.
    Current Date: ${currentDate}.
    
    Your goal is to parse user messages into structured data for generating receipts, or identify other commands.
    
    RULES:
    1. EXTRACT these fields for a receipt:
       - customerName (String)
       - items (Array of objects: { name, price (number), quantity (number, default 1) })
       - paymentMethod (String)
    
    2. CONTEXT:
       The user might provide info in pieces.
       Current Known Data: ${contextDescription}
       MERGE new info with the Current Known Data. If the user changes something (e.g., "Change price to 5k"), overwrite the old value.
    
    3. INTENTS:
       - "RECEIPT": User wants to create/continue a receipt.
       - "HISTORY": User wants to see past receipts.
       - "STATS": User wants to see sales statistics.
       - "MYBRAND": User wants to update brand details (logo, address, etc).
       - "CANCEL": User wants to cancel the current process.
       - "CHAT": General conversation, greetings, or questions you can answer directly.
    
    4. OUTPUT JSON FORMAT ONLY:
       {
         "intent": "RECEIPT" | "HISTORY" | "STATS" | "MYBRAND" | "CANCEL" | "CHAT",
         "data": {
           "customerName": "...", 
           "items": [ { "name": "...", "price": 0, "quantity": 1 } ], 
           "paymentMethod": "..."
         },
         "missingFields": ["customerName", "items", "paymentMethod"], 
         "reply": "String message to send to the user"
       }
    
    5. REPLY LOGIC:
       - If intent is "RECEIPT" and fields are missing in 'missingFields', 'reply' must be a polite question asking for ONE or TWO missing pieces.
       - If intent is "RECEIPT" and NO fields are missing, 'reply' should be "Generating your receipt...".
       - If intent is "CHAT", 'reply' should be a helpful answer.
       - If user explicitly mentions "Naira" or "N", treat it as the currency.
    `;

    try {
        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: text }
            ],
            model: "gpt-4o-mini", // Efficient and smart enough for this
            response_format: { type: "json_object" },
            temperature: 0.3,
        });

        const content = completion.choices[0].message.content;
        return JSON.parse(content);
    } catch (error) {
        console.error("OpenAI Error:", error);
        // Fallback in case of AI failure
        return {
            intent: "CHAT",
            data: currentContext,
            missingFields: [],
            reply: "I'm having trouble connecting to my brain right now. Please try again in a moment."
        };
    }
}
