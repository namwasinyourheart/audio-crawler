const express = require('express');
const router = express.Router();
const ytdlpService = require('../services/ytdlpService');
const queueService = require('../services/queueService');
const { strictLimiter } = require('../middleware/rateLimiter');
const { DOWNLOAD_PATH } = require('../config/constants');

// POST /api/fetch - Get video metadata
router.post('/fetch', async (req, res, next) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        const isPlaylist = ytdlpService.looksLikePlaylist(url);
        
        if (isPlaylist) {
            const result = await ytdlpService.fetchPlaylist(url);
            return res.json({
                type: 'playlist',
                items: result.items,
                count: result.items.length
            });
        }

        const { info, presets } = await ytdlpService.fetchInfo(url);
        res.json({
            type: 'video',
            info,
            presets
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/fetch-playlist - Get playlist items
router.post('/fetch-playlist', async (req, res, next) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        const result = await ytdlpService.fetchPlaylist(url);
        res.json({
            items: result.items,
            count: result.items.length
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/download - Add video to queue
router.post('/download', strictLimiter, async (req, res, next) => {
    try {
        const { 
            url, 
            formatId, 
            extractAudio = false, 
            audioFormat = 'mp3',
            outputDir = DOWNLOAD_PATH,
            startTime,
            endTime
        } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        const isPlaylist = ytdlpService.looksLikePlaylist(url);
        if (isPlaylist) {
            return res.status(400).json({ 
                error: 'Playlist URLs not supported here. Use /api/fetch-playlist and queue individual items.' 
            });
        }

        const result = await queueService.addToQueue({
            url,
            formatId,
            extractAudio,
            audioFormat,
            outputDir,
            startTime,
            endTime
        });

        res.status(201).json({
            jobId: result.jobId,
            status: result.status,
            position: result.position,
            wsUrl: `/ws/download/${result.jobId}`
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/download/batch - Add multiple videos to queue
router.post('/download/batch', strictLimiter, async (req, res, next) => {
    try {
        const { 
            items, 
            formatId,
            extractAudio = false,
            audioFormat = 'mp3',
            outputDir = DOWNLOAD_PATH
        } = req.body;
        
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Items array is required' });
        }

        const results = [];
        for (const item of items) {
            const result = await queueService.addToQueue({
                url: item.url,
                formatId: item.formatId || formatId,
                extractAudio: item.extractAudio || extractAudio,
                audioFormat: item.audioFormat || audioFormat,
                outputDir,
                startTime: item.startTime,
                endTime: item.endTime
            });
            results.push({
                jobId: result.jobId,
                url: item.url,
                status: result.status
            });
        }

        res.status(201).json({
            count: results.length,
            jobs: results
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
