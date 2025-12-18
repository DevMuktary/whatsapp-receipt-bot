// services/whatsappService.js
import axios from 'axios';
import FormData from 'form-data';

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const IMGBB_API_KEY = process.env.IMGBB_API_KEY;

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
        console.error('Send Message Error:', e.response?.data || e.message);
    }
}

export async function sendMedia(to, buffer, mimeType, caption = '', filename = 'file') {
    try {
        // 1. Upload Media
        const form = new FormData();
        form.append('messaging_product', 'whatsapp');
        form.append('file', buffer, { contentType: mimeType, filename: filename });
        
        const uploadRes = await axios.post(
            `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_NUMBER_ID}/media`,
            form,
            { headers: { ...form.getHeaders(), 'Authorization': `Bearer ${WHATSAPP_TOKEN}` } }
        );
        
        const mediaId = uploadRes.data.id;

        // 2. Send Media Message
        let messageBody = {};
        if (mimeType.startsWith('image/')) {
            messageBody = { type: 'image', image: { id: mediaId, caption } };
        } else {
            messageBody = { type: 'document', document: { id: mediaId, caption, filename } };
        }

        await api.post('/messages', {
            messaging_product: 'whatsapp',
            to: to,
            ...messageBody
        });
    } catch (e) {
        console.error('Send Media Error:', e.response?.data || e.message);
        await sendMessage(to, "Failed to send the file.");
    }
}

export async function uploadLogoToImgBB(buffer) {
    try {
        const form = new FormData();
        form.append('image', buffer, { filename: 'logo.png' });
        const res = await axios.post(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, form, { headers: form.getHeaders() });
        return res.data.data.display_url;
    } catch (e) {
        console.error('ImgBB Error:', e.message);
        return null;
    }
}
