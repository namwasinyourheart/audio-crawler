const WebSocket = require('ws');
const { queue } = require('../services/queueService');

function setupWebSocket(server) {
    const wss = new WebSocket.Server({ 
        server,
        path: '/ws'
    });

    wss.on('connection', (ws, req) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const pathParts = url.pathname.split('/');
        const jobId = pathParts[pathParts.length - 1];

        console.log(`WebSocket connected for job: ${jobId}`);

        if (!jobId || jobId === 'ws') {
            ws.send(JSON.stringify({ error: 'Job ID required' }));
            ws.close();
            return;
        }

        queue.setWsConnection(parseInt(jobId), ws);

        ws.send(JSON.stringify({
            type: 'connected',
            jobId,
            message: 'WebSocket connected, waiting for download progress'
        }));

        ws.on('close', () => {
            console.log(`WebSocket closed for job: ${jobId}`);
            queue.removeWsConnection(parseInt(jobId));
        });

        ws.on('error', (err) => {
            console.error(`WebSocket error for job ${jobId}:`, err.message);
            queue.removeWsConnection(parseInt(jobId));
        });

        ws.on('message', async (data) => {
            try {
                const msg = JSON.parse(data);
                
                if (msg.action === 'getStatus') {
                    const items = queue.getAll();
                    const item = items.find(i => i.id === parseInt(jobId));
                    ws.send(JSON.stringify({
                        type: 'status',
                        data: item || { error: 'Job not found' }
                    }));
                }
                
                if (msg.action === 'cancel') {
                    queue.remove(parseInt(jobId));
                    ws.send(JSON.stringify({
                        type: 'cancelled',
                        jobId
                    }));
                }
            } catch (err) {
                ws.send(JSON.stringify({
                    type: 'error',
                    error: 'Invalid message format'
                }));
            }
        });
    });

    return wss;
}

module.exports = { setupWebSocket };
