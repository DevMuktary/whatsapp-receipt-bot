// routes.js
import express from 'express';
import { processIncomingMessage } from './controllers/messageController.js';

const router = express.Router();
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// Home Check
router.get('/', (req, res) => res.status(200).send('SmartReceipt Bot AI Server is running.'));

// Facebook Webhook Verification
router.get("/webhook", (req, res) => {
    if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
        res.status(200).send(req.query["hub.challenge"]);
    } else {
        res.sendStatus(403);
    }
});

// Incoming Messages
router.post("/webhook", async (req, res) => {
    res.sendStatus(200); // Always return 200 OK immediately
    const body = req.body;
    if (body.object === "whatsapp_business_account" && body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
        const message = body.entry[0].changes[0].value.messages[0];
        // Process in background
        processIncomingMessage(message).catch(err => console.error("Error processing message:", err));
    }
});

export default router;
