// services/whatsappService.js
import axios from 'axios';
import FormData from 'form-data';

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

const api = axios.create({
    baseURL: `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_NUMBER_ID}`,
    headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
});

export async function sendMessage(to, text) {
    try {
        await api.post('/messages', {
            messaging_product: 'whatsapp',
            to: to,
            text: { body: text }
        });
    } catch (e) {
        console.error('Send Msg Error:', e.response?.data || e.message);
    }
}

// --- NEW FUNCTION FOR MENUS ---
export async function sendInteractiveMessage(to, interactiveObject) {
    try {
        await api.post('/messages', {
            messaging_product: 'whatsapp',
            to: to,
            type: 'interactive',
            interactive: interactiveObject
        });
    } catch (e) {
        console.error('Send Interactive Error:', e.response?.data || e.message);
    }
}

export async function sendMedia(to, buffer, mimeType, caption = '', filename = 'file') {
    try {
        const form = new FormData();
        form.append('messaging_product', 'whatsapp');
        form.append('file', buffer, { contentType: mimeType, filename });
        
        const uploadRes = await axios.post(
            `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_NUMBER_ID}/media`,
            form,
            { headers: { ...form.getHeaders(), 'Authorization': `Bearer ${WHATSAPP_TOKEN}` } }
        );

        let messageBody = {};
        if (mimeType.startsWith('image/')) {
            messageBody = { type: 'image', image: { id: uploadRes.data.id, caption } };
        } else {
            messageBody = { type: 'document', document: { id: uploadRes.data.id, caption, filename } };
        }

        await api.post('/messages', { messaging_product: 'whatsapp', to, ...messageBody });
    } catch (e) {
        console.error('Send Media Error:', e.response?.data || e.message);
        await sendMessage(to, "Failed to send the file.");
    }
}
