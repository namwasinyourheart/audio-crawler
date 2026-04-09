const API_KEY = process.env.API_KEY;

function apiKeyAuth(req, res, next) {
    if (!API_KEY) {
        return next();
    }

    const key = req.headers['x-api-key'] || req.query.apiKey;
    
    if (!key) {
        return res.status(401).json({ error: 'API key required' });
    }

    if (key !== API_KEY) {
        return res.status(403).json({ error: 'Invalid API key' });
    }

    next();
}

module.exports = { apiKeyAuth };
