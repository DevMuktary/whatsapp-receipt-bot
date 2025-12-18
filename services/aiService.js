// services/aiService.js
import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export async function analyzeMessage(text, currentContext = {}) {
    const currentDate = new Date().toLocaleDateString('en-NG');
    const contextDescription = JSON.stringify(currentContext || {});

    const systemPrompt = `
    You are the intelligent assistant for a Receipt Generator Bot.
    Current Date: ${currentDate}.
    
    GOAL: Extract receipt data or identify commands.
    
    CONTEXT:
    Known Data: ${contextDescription}
    (Merge new info with Known Data. Overwrite if changed.)
    
    INTENTS:
    - "RECEIPT": Create/Update receipt. Extract: customerName, items (name, price, quantity), paymentMethod.
    - "HISTORY": View past receipts.
    - "STATS": View sales stats.
    - "CANCEL": Stop current action.
    - "CHAT": General questions.

    OUTPUT JSON:
    {
      "intent": "RECEIPT" | "HISTORY" | "STATS" | "CANCEL" | "CHAT",
      "data": { "customerName": "...", "items": [...], "paymentMethod": "..." },
      "missingFields": ["customerName", "items", "paymentMethod"], 
      "reply": "Message to user"
    }
    
    REPLY RULES:
    - If "RECEIPT" and fields missing: Ask politely for them.
    - If "CHAT": Answer helpfuly.
    `;

    try {
        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: text }
            ],
            model: "gpt-4o-mini",
            response_format: { type: "json_object" },
            temperature: 0.3,
        });

        return JSON.parse(completion.choices[0].message.content);
    } catch (error) {
        console.error("OpenAI Error:", error);
        return { 
            intent: "CHAT", 
            data: currentContext, 
            missingFields: [], 
            reply: "My brain is a bit foggy. Please try again." 
        };
    }
}
