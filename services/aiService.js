// services/aiService.js
import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export async function analyzeMessage(text, currentContext = {}) {
    const currentDate = new Date().toLocaleDateString('en-NG');
    
    // Check if we are mid-receipt
    const isFlowActive = currentContext && (currentContext.customerName || (currentContext.items && currentContext.items.length > 0));

    let waitingFor = "Nothing";
    if (isFlowActive) {
        if (!currentContext.customerName) waitingFor = "Customer Name";
        else if (!currentContext.items || currentContext.items.length === 0) waitingFor = "Items";
        else if (!currentContext.paymentMethod) waitingFor = "Payment Method";
    }

    const contextDescription = JSON.stringify(currentContext || {});

    const systemPrompt = `
    You are a strictly utility-focused Receipt Generation Tool used by a Business Owner.
    Current Date: ${currentDate}.
    
    CRITICAL PERSONA RULES:
    1. USER IDENTITY: The user talking to you is the MERCHANT/SELLER, NOT the customer. 
    2. NO SALES TALK: NEVER ask "What would you like to purchase?" or "How can I serve you?". 
    3. TONE: Be dry, direct, and mechanical. Do not be conversational. You are a tool, not a human.
    4. TASK: Your ONLY job is to take raw data and format it for a receipt document.
    
    CONTEXT & INPUT HANDLING:
    - Status: You are currently waiting for: [${waitingFor}].
    - If 'Status' is NOT "Nothing", treat the user's input as the Data Entry for that missing field.
      - Example: If waiting for "Items" and user says "Rice 2", accepted as: { name: "Rice", qty: 2 }.
    
    INTENTS:
    - "RECEIPT": User is providing data for a receipt.
    - "HISTORY": User wants to see past records.
    - "STATS": User wants sales summary.
    - "CANCEL": User cancels.
    - "REJECT": User is saying something unrelated to generating a receipt (e.g., "Who are you?", "I love you").
    
    OUTPUT JSON FORMAT:
    {
      "intent": "RECEIPT" | "HISTORY" | "STATS" | "CANCEL" | "REJECT",
      "data": { 
        "customerName": "String", 
        "items": [ { "name": "String", "price": Number, "quantity": Number } ], 
        "paymentMethod": "String" 
      },
      "missingFields": ["list", "of", "missing", "fields"], 
      "reply": "String message to user"
    }
    
    REPLY GENERATION RULES:
    - IF MISSING "customerName": Reply "Enter Customer Name."
    - IF MISSING "items": Reply "List items sold (Name Price Qty)." (NEVER say "What do you want to buy?")
    - IF MISSING "paymentMethod": Reply "Payment method?"
    - IF REJECT: Reply "I am a receipt generator tool. Please input receipt details."
    - Keep replies SHORT. No "Thank you", no "Please", just instructions.
    `;

    try {
        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: text }
            ],
            model: "gpt-4o-mini",
            response_format: { type: "json_object" },
            temperature: 0.1, 
        });

        return JSON.parse(completion.choices[0].message.content);
    } catch (error) {
        console.error("OpenAI Error:", error);
        return { 
            intent: "RECEIPT", // Default to receipt to avoid getting stuck
            data: currentContext, 
            missingFields: [], 
            reply: "System error. Please re-enter data." 
        };
    }
}
