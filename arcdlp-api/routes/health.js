const express = require('express');
const router = express.Router();
const ytdlpService = require('../services/ytdlpService');

// GET /api/health - Health check
router.get('/', (req, res) => {
    const deps = ytdlpService.checkDeps();
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        dependencies: deps
    });
});

// GET /api/health/deps - Detailed dependency check
router.get('/deps', (req, res) => {
    const deps = ytdlpService.checkDeps();
    const allGood = deps.ytdlp.found && deps.ffmpeg.found;
    
    res.status(allGood ? 200 : 503).json({
        status: allGood ? 'ok' : 'degraded',
        dependencies: deps
    });
});

module.exports = router;
