import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export async function analyzeMessage(text, currentContext = {}) {
    // 1. DETERMINE STATE
    // We strictly define what we are waiting for.
    let currentState = "IDLE";
    if (currentContext) {
        if (!currentContext.customerName) currentState = "AWAITING_CUSTOMER_NAME";
        else if (!currentContext.items || currentContext.items.length === 0) currentState = "AWAITING_ITEMS";
        else if (!currentContext.paymentMethod) currentState = "AWAITING_PAYMENT_METHOD";
        else currentState = "COMPLETE";
    }

    const contextDescription = JSON.stringify(currentContext || {});

    // 2. SYSTEM PROMPT
    // Key Change: We explicitly tell AI that the input IS the answer.
    const systemPrompt = `
    You are a Data Entry Parser.
    
    CURRENT STATE: ${currentState}
    EXISTING DATA: ${contextDescription}
    
    GLOBAL COMMANDS (Override Everything):
    - "Cancel", "Stop", "Reset" -> Intent = "CANCEL"
    - "Hi", "Hello", "Menu" -> Intent = "CHAT"
    - "New Receipt", "CMD_RECEIPT" -> Intent = "RECEIPT" (Do not extract data yet)

    LOGIC FOR EACH STATE:

    1. STATE: AWAITING_CUSTOMER_NAME
       - The User's input IS the Customer Name. 
       - DO NOT JUDGE IT. Even if it looks weird, take it as the name.
       - Example: "Mukhtar" -> customerName: "Mukhtar"
       - Example: "Mr John" -> customerName: "Mr John"

    2. STATE: AWAITING_ITEMS
       - Extract items from text.
       - Format: items: [{ name: "String", price: Number, quantity: Number }]
       - If user types a list (e.g., "Rice 2 3000, Beans 1 5000"), extract ALL.
       - DEFAULT: If price/qty is missing, use 0 or 1.

    3. STATE: AWAITING_PAYMENT_METHOD
       - The User's input IS the Payment Method.
       - Example: "Transfer" -> paymentMethod: "Transfer"

    4. STATE: IDLE or COMPLETE
       - If input looks like a receipt command (e.g. "Receipt for Ben"), extract data.
       - Otherwise, Intent = "CHAT" or "REJECT" (only reject if truly nonsense like "asdfgh").

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
            temperature: 0.0, // Strict logic
        });

        const aiResult = JSON.parse(completion.choices[0].message.content);
        
        // --- 3. JAVASCRIPT LOGIC LAYER ---
        let finalIntent = aiResult.intent;
        let finalData = aiResult.data || {};
        
        // Merge with existing context
        finalData = { ...currentContext, ...finalData };
        
        // --- FORCE ACCEPTANCE LOGIC (The "Normal" Fix) ---
        // If we were waiting for something, and the AI returned "RECEIPT" (or even "CHAT"),
        // we assume the user provided the data.
        
        if (currentState === "AWAITING_CUSTOMER_NAME" && !finalData.customerName) {
            // If AI failed to pick the name but user sent text, USE THE TEXT AS NAME.
            // Unless it's a keyword like "Cancel"
            if (finalIntent !== 'CANCEL' && finalIntent !== 'CHAT') {
                finalData.customerName = text; // Just take the raw text!
                finalIntent = 'RECEIPT';
            }
        }
        
        if (currentState === "AWAITING_PAYMENT_METHOD" && !finalData.paymentMethod) {
            if (finalIntent !== 'CANCEL' && finalIntent !== 'CHAT') {
                finalData.paymentMethod = text; // Just take the raw text!
                finalIntent = 'RECEIPT';
            }
        }

        // Calculate Missing Fields
        const missingFields = [];
        if (finalIntent === 'RECEIPT' || finalIntent === 'CHAT') {
            if (!finalData.customerName) missingFields.push("customerName");
            else if (!finalData.items || finalData.items.length === 0) missingFields.push("items");
            else if (!finalData.paymentMethod) missingFields.push("paymentMethod");
        }

        // Generate Reply
        let reply = "";
        
        if (finalIntent === 'CANCEL') {
            reply = "🚫 Cancelled.";
        } else if (finalIntent === 'REJECT') {
            reply = "Please enter the receipt details.";
        } else if (finalIntent === 'HISTORY' || finalIntent === 'STATS') {
             // Controller handles this
        } else {
            // Receipt Flow
            if (missingFields.includes("customerName")) {
                reply = "Enter Customer Name.";
                finalIntent = "RECEIPT"; 
            } else if (missingFields.includes("items")) {
                reply = "Enter Items (Name Price Qty).";
                finalIntent = "RECEIPT";
            } else if (missingFields.includes("paymentMethod")) {
                reply = "Enter Payment Method.";
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
        // Fallback: If AI crashes, treat input as "CHAT" to prevent "Invalid Input" block
        return { 
            intent: "CHAT", 
            data: currentContext, 
            missingFields: ["error"], 
            reply: "System error. Please try again." 
        };
    }
}
