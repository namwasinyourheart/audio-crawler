const express = require('express');
const router = express.Router();
const queueService = require('../services/queueService');

// GET /api/queue - Get all queue items
router.get('/', async (req, res, next) => {
    try {
        const status = await queueService.getQueueStatus();
        res.json(status);
    } catch (error) {
        next(error);
    }
});

// GET /api/queue/counts - Get queue counts only
router.get('/counts', async (req, res, next) => {
    try {
        const status = await queueService.getQueueStatus();
        res.json({ counts: status.counts });
    } catch (error) {
        next(error);
    }
});

// GET /api/queue/:jobId - Get specific job details
router.get('/:jobId', async (req, res, next) => {
    try {
        const { jobId } = req.params;
        const job = await queueService.getJob(jobId);
        
        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }
        
        res.json(job);
    } catch (error) {
        next(error);
    }
});

// DELETE /api/queue/:jobId - Cancel/remove a job
router.delete('/:jobId', async (req, res, next) => {
    try {
        const { jobId } = req.params;
        const result = await queueService.cancelJob(jobId);
        
        if (!result) {
            return res.status(404).json({ error: 'Job not found' });
        }
        
        res.json({ success: true, message: 'Job cancelled' });
    } catch (error) {
        next(error);
    }
});

// POST /api/queue/:jobId/retry - Retry a failed job
router.post('/:jobId/retry', async (req, res, next) => {
    try {
        const { jobId } = req.params;
        const result = await queueService.retryJob(jobId);
        
        if (!result) {
            return res.status(404).json({ error: 'Job not found' });
        }
        
        res.json({
            jobId: result.jobId,
            status: result.status
        });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/queue - Clear all completed jobs
router.delete('/', async (req, res, next) => {
    try {
        await queueService.clearCompleted();
        res.json({ success: true, message: 'Completed jobs cleared' });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
