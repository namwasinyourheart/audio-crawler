require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');

const { limiter } = require('../middleware/rateLimiter');
const { apiKeyAuth } = require('../middleware/auth');
const errorHandler = require('../middleware/errorHandler');
const { setupWebSocket } = require('../websocket/progressHandler');
const { queue } = require('../services/queueService');

const downloadRoutes = require('../routes/download');
const queueRoutes = require('../routes/queue');
const healthRoutes = require('../routes/health');

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

const app = express();
const server = http.createServer(app);

// Setup queue callbacks for logging
queue.setCallbacks({
    onLog: (msg) => {
        console.log(`[Queue] ${msg}`);
    },
    onItemUpdate: (item) => {
        console.log(`[Queue] Item ${item.id} updated: ${item.state}`);
    },
    onQueueUpdate: (data) => {
        console.log(`[Queue] Status - Pending: ${data.counts.pending}, Active: ${data.counts.downloading}, Completed: ${data.counts.completed}, Failed: ${data.counts.failed}`);
    }
});

// Security middleware
app.use(helmet());
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'x-api-key']
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
app.use(limiter);

// API Key authentication
app.use(apiKeyAuth);

// Routes
app.use('/api/health', healthRoutes);
app.use('/api', downloadRoutes);
app.use('/api/queue', queueRoutes);

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'ArcDLP API',
        version: '1.0.0',
        endpoints: {
            health: '/api/health',
            fetch: '/api/fetch',
            download: '/api/download',
            queue: '/api/queue',
            websocket: '/ws/download/:jobId'
        }
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use(errorHandler);

// Setup WebSocket
setupWebSocket(server);

// Start server
server.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║          ArcDLP API Server             ║
╠════════════════════════════════════════╣
║  Environment: ${NODE_ENV.padEnd(23)} ║
║  Port:       ${PORT.toString().padEnd(23)} ║
╚════════════════════════════════════════╝
`);
    console.log('Endpoints:');
    console.log('  GET  /api/health       - Health check');
    console.log('  POST /api/fetch        - Fetch video info');
    console.log('  POST /api/download     - Start download');
    console.log('  GET  /api/queue        - Queue status');
    console.log('  WS   /ws/download/:id - Progress updates');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
