function errorHandler(err, req, res, next) {
    console.error('Error:', err.message);
    console.error(err.stack);

    if (err.message && err.message.includes('yt-dlp')) {
        return res.status(400).json({
            error: 'Download error',
            message: err.message,
            code: 'YTDLP_ERROR'
        });
    }

    if (err.message && err.message.includes('timed out')) {
        return res.status(408).json({
            error: 'Request timeout',
            message: err.message,
            code: 'TIMEOUT'
        });
    }

    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
        code: 'INTERNAL_ERROR'
    });
}

module.exports = errorHandler;
