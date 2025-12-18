import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export async function analyzeMessage(text, currentContext = {}) {
    const currentDate = new Date().toLocaleDateString('en-NG');
    
    // We explicitly tell the AI what the user was doing last (The "State")
    const contextDescription = JSON.stringify(currentContext || {});
    const isMidFlow = Object.keys(currentContext).length > 0;

    const systemPrompt = `
    You are a strict, professional Receipt Generator Assistant for a Nigerian business.
    Current Date: ${currentDate}.
    
    STRICT BEHAVIOR RULES:
    1. DO NOT discuss sports, politics, religion, relationship advice, or general trivia.
    2. If the user says something off-topic (e.g., "Who won the match?", "I am lonely"), reject it politely: "I can only help you generate receipts or manage your business data."
    3. You UNDERSTAND Nigerian Pidgin, but you REPLY in clear, professional English.
    
    TASK:
    Analyze the user's input to extract receipt data or identify business commands.
    
    CONTEXT AWARENESS:
    - The user might be answering a specific question I asked them previously.
    - Current Known Data (Context): ${contextDescription}
    - If I already have "customerName" and the user sends a number, assume it is the "price" or "quantity" for the item, not a random number.
    - MERGE new info with Known Data.
    
    INTENTS:
    - "RECEIPT": User wants to create/update a receipt. Extract: customerName, items (name, price, quantity), paymentMethod.
    - "HISTORY": User wants to see past receipts.
    - "STATS": User wants to see sales statistics.
    - "CANCEL": User wants to stop the current process.
    - "CHAT": GREETINGS only (Hi, Hello). For anything else off-topic, set intent to "REJECT".
    
    OUTPUT JSON FORMAT:
    {
      "intent": "RECEIPT" | "HISTORY" | "STATS" | "CANCEL" | "CHAT" | "REJECT",
      "data": { 
        "customerName": "String", 
        "items": [ { "name": "String", "price": Number, "quantity": Number } ], 
        "paymentMethod": "String" 
      },
      "missingFields": ["list", "of", "missing", "fields"], 
      "reply": "String message to user"
    }
    
    REPLY LOGIC:
    - If "RECEIPT" and fields are missing: "reply" should ask SPECIFICALLY for the missing field. (e.g., "What is the price for the bag?").
    - If "REJECT": "reply" should be "I am designed only for business receipts. Please tell me what you sold."
    `;

    try {
        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: text }
            ],
            model: "gpt-4o-mini", // Fast and cost-effective
            response_format: { type: "json_object" },
            temperature: 0.1, // Very low temperature = strict, less creative
        });

        return JSON.parse(completion.choices[0].message.content);
    } catch (error) {
        console.error("OpenAI Error:", error);
        // Fail-safe response
        return { 
            intent: "CHAT", 
            data: currentContext, 
            missingFields: [], 
            reply: "I'm having trouble connecting to the server. Please try again." 
        };
    }
}
