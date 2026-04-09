const rateLimit = require('express-rate-limit');

const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000;
const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 30;

const limiter = rateLimit({
    windowMs: WINDOW_MS,
    max: MAX_REQUESTS,
    message: {
        error: 'Too many requests, please try again later',
        retryAfter: Math.ceil(WINDOW_MS / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const strictLimiter = rateLimit({
    windowMs: WINDOW_MS,
    max: 10,
    message: {
        error: 'Too many download requests, please try again later',
        retryAfter: Math.ceil(WINDOW_MS / 1000)
    },
});

module.exports = {
    limiter,
    strictLimiter
};
