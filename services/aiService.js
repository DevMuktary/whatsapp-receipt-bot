import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export async function analyzeMessage(text, currentContext = {}) {
    // 1. DETERMINE CURRENT STATE
    let currentState = "IDLE";
    if (currentContext) {
        if (!currentContext.customerName) currentState = "AWAITING_CUSTOMER_NAME";
        else if (!currentContext.items || currentContext.items.length === 0) currentState = "AWAITING_ITEMS";
        else if (!currentContext.paymentMethod) currentState = "AWAITING_PAYMENT_METHOD";
        else currentState = "COMPLETE";
    }

    const contextDescription = JSON.stringify(currentContext || {});

    // 2. SYSTEM PROMPT
    const systemPrompt = `
    You are a Data Extraction Engine.
    
    CURRENT STATE: ${currentState}
    EXISTING DATA: ${contextDescription}
    
    STRICT RULES:
    1. IF input is "New Receipt", "Create Receipt", "Start", or "CMD_RECEIPT":
       -> Intent = "RECEIPT"
       -> (Do not extract data, just set intent).
    
    2. IF input is "Cancel", "Reset", "Stop":
       -> Intent = "CANCEL"
    
    3. IF input is "Hi", "Hello", "Menu":
       -> Intent = "CHAT"
    
    4. EXTRACT data based on State (Name -> Items -> Payment).
       - Items: Must be [{ name, price, quantity }].
       - Numbers: Convert "2k" to 2000.
    
    5. IF input is totally unrelated (e.g. sports) AND State is NOT IDLE:
       -> Intent = "REJECT"
    
    OUTPUT JSON:
    {
      "intent": "RECEIPT" | "HISTORY" | "STATS" | "CANCEL" | "REJECT" | "CHAT",
      "data": { ... }
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
        
        // --- 3. LOGIC LAYER ---
        let finalIntent = aiResult.intent;
        let finalData = aiResult.data || {};
        
        // Merge data
        finalData = { ...currentContext, ...finalData };
        
        // Calculate Missing Fields
        const missingFields = [];
        if (finalIntent === 'RECEIPT' || finalIntent === 'CHAT') {
            if (!finalData.customerName) missingFields.push("customerName");
            else if (!finalData.items || finalData.items.length === 0) missingFields.push("items");
            else if (!finalData.paymentMethod) missingFields.push("paymentMethod");
        }

        // Generate Strict Reply
        let reply = "";
        
        if (finalIntent === 'CANCEL') {
            reply = "🚫 Receipt cancelled.";
        } else if (finalIntent === 'REJECT') {
            reply = "Invalid input. Please enter the required details.";
        } else if (finalIntent === 'HISTORY' || finalIntent === 'STATS') {
             // Handled by controller
        } else {
            // Receipt Flow
            if (missingFields.includes("customerName")) {
                reply = "Enter Customer Name.";
                finalIntent = "RECEIPT"; 
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
            missingFields: missingFields,
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
