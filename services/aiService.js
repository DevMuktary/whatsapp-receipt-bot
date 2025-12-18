// services/aiService.js
import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export async function analyzeMessage(text, currentContext = {}) {
    const currentDate = new Date().toLocaleDateString('en-NG');
    
    // Check if we are already in the middle of a receipt conversation
    const isFlowActive = currentContext && (currentContext.customerName || (currentContext.items && currentContext.items.length > 0));

    // Create a clear summary of what we are waiting for
    let waitingFor = "Nothing";
    if (isFlowActive) {
        if (!currentContext.customerName) waitingFor = "Customer Name";
        else if (!currentContext.items || currentContext.items.length === 0) waitingFor = "Items";
        else if (!currentContext.paymentMethod) waitingFor = "Payment Method";
    }

    const contextDescription = JSON.stringify(currentContext || {});

    const systemPrompt = `
    You are a smart Receipt Assistant for a Nigerian business.
    Current Date: ${currentDate}.
    
    CRITICAL CONTEXT RULES:
    1. STATUS: You are currently waiting for: [${waitingFor}].
    2. IF 'STATUS' is NOT "Nothing", you MUST interpret the user's short input as the answer to that missing item.
       - Example: If waiting for "Payment Method" and user says "Transfer", do NOT reject it. Map it to 'paymentMethod'.
       - Example: If waiting for "Items" and user says "Rice 2", map it to items.
    
    STRICT BEHAVIOR (Only if NOT waiting for input):
    - If the user is starting fresh and says something unrelated (e.g., "Who won the match?"), reject it with intent "REJECT".
    - You understand Nigerian Pidgin/English but reply in clean English.

    TASK:
    Extract receipt data.
    
    INTENTS:
    - "RECEIPT": Create/Update receipt.
    - "HISTORY": View past receipts.
    - "STATS": View sales stats.
    - "CANCEL": Stop current action.
    - "REJECT": Off-topic nonsense (ONLY if not waiting for input).
    - "CHAT": Greetings only.
    
    OUTPUT JSON FORMAT:
    {
      "intent": "RECEIPT" | "HISTORY" | "STATS" | "CANCEL" | "REJECT" | "CHAT",
      "data": { 
        "customerName": "String", 
        "items": [ { "name": "String", "price": Number, "quantity": Number } ], 
        "paymentMethod": "String" 
      },
      "missingFields": ["list", "of", "missing", "fields"], 
      "reply": "String message to user"
    }
    
    REPLY GUIDELINES:
    - If missing fields: Ask for the NEXT missing field politely.
    - If user provides "Rice 2 3000", understand it as: Name=Rice, Qty=2, UnitPrice=3000.
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
            intent: "CHAT", 
            data: currentContext, 
            missingFields: [], 
            reply: "Network glitch. Please say that again." 
        };
    }
}
