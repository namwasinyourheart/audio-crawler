const Redis = require('ioredis');
const { REDIS_URL } = require('./constants');

const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
        if (times > 3) return null;
        return Math.min(times * 100, 3000);
    }
});

redis.on('connect', () => {
    console.log('Redis connected');
});

redis.on('error', (err) => {
    console.error('Redis error:', err.message);
});

module.exports = redis;
