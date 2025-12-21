import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export async function analyzeMessage(text, currentContext = {}) {
    // 1. DETERMINE STATE
    // We calculate this first to guide the AI rigidly.
    let currentState = "IDLE";
    let missingField = "None";

    if (currentContext && Object.keys(currentContext).length > 0) {
        if (!currentContext.customerName) {
            currentState = "AWAITING_CUSTOMER_NAME";
            missingField = "Customer Name";
        } else if (!currentContext.items || currentContext.items.length === 0) {
            currentState = "AWAITING_ITEMS";
            missingField = "Items (Name, Price, Qty)";
        } else if (!currentContext.paymentMethod) {
            currentState = "AWAITING_PAYMENT_METHOD";
            missingField = "Payment Method";
        } else {
            currentState = "COMPLETE";
            missingField = "None (Receipt Ready)";
        }
    }

    const contextDescription = JSON.stringify(currentContext || {});

    // 2. STRICT SYSTEM PROMPT
    const systemPrompt = `
    You are a strictly logical Data Entry Bot. You are NOT a chat assistant.
    
    CURRENT STATE: ${currentState}
    EXISTING DATA: ${contextDescription}
    
    GLOBAL PRIORITY RULE (CANCEL/RESET):
    - If user says "Cancel", "Reset", "Start over", "Stop", or "Clear":
      -> Intent = "CANCEL"
      -> Reply = "Receipt cancelled."
      -> Ignore all other text in the message.

    STATE-SPECIFIC INSTRUCTIONS:
    
    1. STATE: IDLE
       - If user says "Hi", "Hello", "Menu": Intent="CHAT". Reply="Ready. Enter Customer Name."
       - If user starts a receipt (e.g. "Receipt for Musa"): Extract "customerName". Intent="RECEIPT".
       - If user says "History" or "Stats": Intent="HISTORY" / "STATS".

    2. STATE: AWAITING_CUSTOMER_NAME
       - The entire input is the Name.
       - Extract: "customerName".

    3. STATE: AWAITING_ITEMS
       - Extract ALL items from the text.
       - CRITICAL: Users may list multiple items (e.g., "Rice 2 4000, Beans 5000").
       - CRITICAL: "price" and "quantity" MUST be Numbers. Remove currency symbols or text.
       - Structure: items: [{ name: "String", price: Number, quantity: Number }]

    4. STATE: AWAITING_PAYMENT_METHOD
       - Extract the method (e.g., Cash, Transfer, POS).

    5. STATE: COMPLETE
       - The receipt is already finished. 
       - DO NOT extract any new Name, Items, or Payment.
       - If input is "Cancel" -> Intent="CANCEL".
       - If input is irrelevant -> Intent="CHAT" (Reply: "Receipt is ready. Check above.").
    
    OUTPUT JSON FORMAT:
    {
      "intent": "RECEIPT" | "HISTORY" | "STATS" | "CANCEL" | "REJECT" | "CHAT",
      "data": { 
        "customerName": "String", 
        "items": [ { "name": "String", "price": Number, "quantity": Number } ], 
        "paymentMethod": "String" 
      },
      "reply": "String (Short instruction for the NEXT step)"
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
            temperature: 0.0, // Zero temp = No creativity, strict logic
        });

        return JSON.parse(completion.choices[0].message.content);

    } catch (error) {
        console.error("OpenAI Error:", error);
        
        // RULE 5: Consistent Response Structure for Errors
        return { 
            intent: "CHAT", 
            data: currentContext, 
            // We return the context so data isn't lost on error
            reply: "System error. Please re-enter that detail." 
        };
    }
}
