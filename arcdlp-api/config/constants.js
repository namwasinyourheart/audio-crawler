const path = require('path');

const DOWNLOAD_PATH = process.env.DOWNLOAD_PATH || path.join(process.cwd(), 'downloads');
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_DOWNLOADS) || 3;

module.exports = {
    DOWNLOAD_PATH,
    MAX_CONCURRENT,
    SUPPORTED_SITES: [
        'youtube.com', 'youtu.be',
        'vimeo.com',
        'twitter.com', 'x.com',
        'soundcloud.com',
        'instagram.com',
        'tiktok.com'
    ]
};
