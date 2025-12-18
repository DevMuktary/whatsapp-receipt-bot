// index.js
import express from 'express';
import cors from 'cors';
import { connectToDB } from './db.js';
import router from './routes.js';

const PORT = process.env.PORT || 3000;
const app = express();

// Middleware
app.use(express.json());
const corsOptions = { origin: ['http://smartnaijaservices.com.ng', 'https://smartnaijaservices.com.ng'] };
app.use(cors(corsOptions));

// Routes
app.use('/', router);

// Start Server
async function startServer() {
    await connectToDB();
    console.log('✅ DB Connected.');
    app.listen(PORT, () => console.log(`🚀 Server listening on port ${PORT}`));
}

startServer();
