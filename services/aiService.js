// services/aiService.js
import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export async function analyzeMessage(text, currentContext = {}) {
    // 1. DETERMINE CURRENT STATE (For Prompt Context Only)
    let currentState = "IDLE";
    if (currentContext) {
        if (!currentContext.customerName) currentState = "AWAITING_CUSTOMER_NAME";
        else if (!currentContext.items || currentContext.items.length === 0) currentState = "AWAITING_ITEMS";
        else if (!currentContext.paymentMethod) currentState = "AWAITING_PAYMENT_METHOD";
        else currentState = "COMPLETE";
    }

    const contextDescription = JSON.stringify(currentContext || {});

    // 2. STRICT SYSTEM PROMPT
    const systemPrompt = `
    You are a Data Extraction Engine. You are NOT a chat assistant.
    
    CURRENT STATE: ${currentState}
    EXISTING DATA: ${contextDescription}
    
    RULES:
    1. EXTRACT data from the user's input based on the Current State.
    2. MERGE with Existing Data.
    3. IF input is "Cancel", "Reset", "Stop" -> Intent = "CANCEL".
    4. IF input is "Hi", "Menu" (and State is IDLE) -> Intent = "CHAT".
    5. IF input is unrelated to the task (e.g. sports) -> Intent = "REJECT".
    6. IF STATE IS COMPLETE: Do not extract new receipt data. Only listen for "Cancel" or "Chat".
    
    DATA FORMATTING:
    - items: Must be an array of objects { name, price, quantity }.
    - numbers: Convert text numbers to real numbers (e.g. "2k" -> 2000).
    
    OUTPUT JSON:
    {
      "intent": "RECEIPT" | "HISTORY" | "STATS" | "CANCEL" | "REJECT" | "CHAT",
      "data": { 
        "customerName": "String", 
        "items": [ { "name": "String", "price": Number, "quantity": Number } ], 
        "paymentMethod": "String" 
      }
    }
    `;

    try {
        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: text }
            ],
            model: "gpt-4o-mini",
            response_format: { type: "json_object" },
            temperature: 0.0,
        });

        const aiResult = JSON.parse(completion.choices[0].message.content);
        
        // --- 3. LOGIC LAYER (THE FIX) ---
        // We do not trust the AI to tell us what is missing. We check ourselves.
        
        let finalIntent = aiResult.intent;
        let finalData = aiResult.data || {};
        
        // Merge with previous context if the AI didn't return everything
        finalData = { ...currentContext, ...finalData };
        
        // Explicitly Calculate Missing Fields
        const missingFields = [];
        if (finalIntent === 'RECEIPT' || finalIntent === 'CHAT') {
            if (!finalData.customerName) missingFields.push("customerName");
            else if (!finalData.items || finalData.items.length === 0) missingFields.push("items");
            else if (!finalData.paymentMethod) missingFields.push("paymentMethod");
        }

        // Generate Strict Reply based on Missing Fields
        let reply = "";
        if (finalIntent === 'CANCEL') {
            reply = "🚫 Receipt cancelled.";
        } else if (finalIntent === 'REJECT') {
            reply = "I am a receipt tool. Please enter the required details.";
        } else if (finalIntent === 'HISTORY' || finalIntent === 'STATS') {
             // handled by controller
        } else {
            // Receipt Flow Replies
            if (missingFields.includes("customerName")) {
                reply = "Enter Customer Name.";
                finalIntent = "RECEIPT"; // Force intent
            } else if (missingFields.includes("items")) {
                reply = "Enter Items (Name Price Qty).";
                finalIntent = "RECEIPT";
            } else if (missingFields.includes("paymentMethod")) {
                reply = "Enter Payment Method (Cash, Transfer, POS).";
                finalIntent = "RECEIPT";
            } else {
                reply = "Generating Receipt...";
            }
        }

        return {
            intent: finalIntent,
            data: finalData,
            missingFields: missingFields, // Controller needs this array!
            reply: reply
        };

    } catch (error) {
        console.error("OpenAI Error:", error);
        return { 
            intent: "CHAT", 
            data: currentContext, 
            missingFields: ["error"], 
            reply: "System error. Please re-enter." 
        };
    }
}
