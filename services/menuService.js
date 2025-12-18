// services/menuService.js
import * as whatsappService from './whatsappService.js';

/**
 * Sends the Main Menu (List Message)
 */
export async function sendMainMenu(to) {
    const interactiveMessage = {
        type: "list",
        header: {
            type: "text",
            text: "🤖 *Smart Assistant Menu*"
        },
        body: {
            text: "How can I help you manage your business today?"
        },
        footer: {
            text: "Select an option below"
        },
        action: {
            button: "Open Menu",
            sections: [
                {
                    title: "🧾 Receipt Tools",
                    rows: [
                        { id: "CMD_RECEIPT", title: "New Receipt", description: "Create a sales receipt" },
                        { id: "CMD_HISTORY", title: "History", description: "View recent receipts" },
                        { id: "CMD_STATS", title: "Statistics", description: "See sales performance" }
                    ]
                },
                {
                    title: "⚙️ Settings",
                    rows: [
                        { id: "CMD_MYBRAND", title: "My Brand", description: "Manage logo & details" },
                        { id: "CMD_SUPPORT", title: "Support", description: "Contact admin" }
                    ]
                }
            ]
        }
    };

    await whatsappService.sendInteractiveMessage(to, interactiveMessage);
}

/**
 * Sends a Quick Action Menu (Buttons) - Used after completing a task
 */
export async function sendPostTaskMenu(to, message = "What would you like to do next?") {
    const interactiveMessage = {
        type: "button",
        body: {
            text: message
        },
        action: {
            buttons: [
                {
                    type: "reply",
                    reply: { id: "CMD_RECEIPT", title: "New Receipt" }
                },
                {
                    type: "reply",
                    reply: { id: "CMD_MENU", title: "Main Menu" }
                }
            ]
        }
    };

    await whatsappService.sendInteractiveMessage(to, interactiveMessage);
}
