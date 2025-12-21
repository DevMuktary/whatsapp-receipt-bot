// services/aiService.js
import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export async function analyzeMessage(text, currentContext = {}) {
    // 1. DETERMINE THE CURRENT STATE PROGRAMMATICALLY
    // We do this BEFORE sending to AI so we can force the AI to focus on ONE task.
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
        }
    }

    const contextDescription = JSON.stringify(currentContext || {});

    // 2. THE STRICT SYSTEM PROMPT
    const systemPrompt = `
    You are a Data Entry Bot for a Receipt Generator. You are NOT a chat assistant.
    
    CURRENT STATE: ${currentState}
    MISSING DATA: ${missingField}
    EXISTING DATA: ${contextDescription}
    
    YOUR ONLY GOAL:
    Extract the specific "${missingField}" from the user's text.
    
    STRICT RULES FOR EACH STATE:
    
    1. STATE: IDLE (No active receipt)
       - If user says "Hi", "Hello", "Ai", "Menu": Intent = "CHAT". Reply = "Ready. Please enter the Customer Name."
       - If user provides a name immediately (e.g. "Receipt for Mukhtar"): Intent = "RECEIPT". Extract "customerName": "Mukhtar".
       - If user says "History" or "Stats": Intent = "HISTORY" / "STATS".
    
    2. STATE: AWAITING_CUSTOMER_NAME
       - The User's input IS the name.
       - Input: "Mukhtar" -> Data: { "customerName": "Mukhtar" }
       - Input: "It is Mr. John" -> Data: { "customerName": "Mr. John" }
       - REJECT if user asks a question like "How does this work?".
    
    3. STATE: AWAITING_ITEMS
       - The User's input IS the list of items.
       - Input: "Rice 2 3000" -> Data: items: [{ name: "Rice", quantity: 2, price: 3000 }]
       - Input: "Semovita, 5000" -> Data: items: [{ name: "Semovita", quantity: 1, price: 5000 }]
       - DO NOT ask "What would you like to buy?". Just process the data.
    
    4. STATE: AWAITING_PAYMENT_METHOD
       - The User's input IS the payment type.
       - Input: "Transfer" -> Data: { "paymentMethod": "Transfer" }
       - Input: "Cash" -> Data: { "paymentMethod": "Cash" }
    
    GENERAL RULES:
    - IGNORE all pleasantries.
    - NEVER say "Thank you" or "How can I help".
    - IF input is unrelated to the Current State (e.g., discussing sports), Intent = "REJECT".
    
    OUTPUT JSON FORMAT:
    {
      "intent": "RECEIPT" | "HISTORY" | "STATS" | "CANCEL" | "REJECT" | "CHAT",
      "data": { 
        "customerName": "String (only if extracted)", 
        "items": [ { "name": "String", "price": Number, "quantity": Number } ], 
        "paymentMethod": "String" 
      },
      "reply": "String (Short instruction for the NEXT step)"
    }
    
    REPLY TEMPLATES (Use these exactly):
    - If IDLE: "Enter Customer Name."
    - If Name Saved: "Enter Items (Name Qty Price)."
    - If Items Saved: "Enter Payment Method."
    - If REJECT: "Invalid input. Waiting for [MISSING_FIELD]."
    `;

    try {
        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: text }
            ],
            model: "gpt-4o-mini",
            response_format: { type: "json_object" },
            temperature: 0.0, // Zero temperature for maximum determinism
        });

        return JSON.parse(completion.choices[0].message.content);
    } catch (error) {
        console.error("OpenAI Error:", error);
        // Fallback for safety
        return { 
            intent: "RECEIPT", 
            data: currentContext, 
            missingFields: [], 
            reply: "System error. Please re-enter the last detail." 
        };
    }
}
