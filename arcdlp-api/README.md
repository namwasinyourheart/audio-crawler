# ArcDLP API

REST API + WebSocket service for downloading videos using yt-dlp. Cross-platform (Windows, Linux, macOS).

## Features

- **Fetch video info** - Get metadata, formats, and quality presets
- **Download queue** - In-memory queue for sequential processing (no Redis required)
- **Real-time progress** - WebSocket updates for download progress
- **Batch downloads** - Queue multiple videos at once
- **Playlist support** - Fetch and queue playlist items
- **Rate limiting** - Configurable request throttling
- **API key auth** - Optional authentication
- **Cross-platform** - Works on Windows, Linux, and macOS

## Prerequisites

- Node.js >= 16
- yt-dlp binary (auto-downloaded on first run)
- ffmpeg (bundled via ffmpeg-static, or system ffmpeg)

## Installation

```bash
cd arcdlp-api
npm install

# Copy environment config
cp .env.example .env

# yt-dlp binary is auto-downloaded during npm install
# If manual download needed:

# Windows
mkdir bin
curl -L -o bin/yt-dlp.exe https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe

# Linux/macOS
mkdir bin
curl -L -o bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp
chmod +x bin/yt-dlp
```

## Configuration

Edit `.env`:

```env
PORT=3000
NODE_ENV=production
DOWNLOAD_PATH=./downloads
API_KEY=your-secret-key-here
MAX_CONCURRENT_DOWNLOADS=3
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=30
```

## Running

```bash
# Development (Windows, Linux, macOS)
npm run dev

# Production
npm start

# Server will start on http://localhost:3000
```

## API Endpoints

### Health Check

```bash
GET /api/health
```

### Fetch Video Info

```bash
POST /api/fetch
Content-Type: application/json

{
  "url": "https://youtube.com/watch?v=..."
}
```

**Response:**
```json
{
  "type": "video",
  "info": {
    "id": "...",
    "title": "...",
    "thumbnail": "...",
    "duration": 120,
    "formats": [...]
  },
  "presets": [
    { "id": "best", "label": "Best", "type": "video" },
    { "id": "1080p", "label": "1080p", "tag": "Full HD", "type": "video" },
    { "id": "audio", "label": "MP3", "type": "audio" }
  ]
}
```

### Start Download

```bash
POST /api/download
Content-Type: application/json
X-API-Key: your-secret-key

{
  "url": "https://youtube.com/watch?v=...",
  "formatId": "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
  "extractAudio": false,
  "audioFormat": "mp3",
  "startTime": "00:30:00",
  "endTime": "00:45:30"
}
```

**Parameters:**
- `url` (required) - Video URL
- `formatId` - yt-dlp format ID (e.g., "best", "bestvideo+bestaudio")
- `extractAudio` - Extract audio only (default: false)
- `audioFormat` - Audio format when extractAudio=true (default: "mp3")
- `startTime` - Start time for trimming (format: HH:MM:SS or seconds)
- `endTime` - End time for trimming (format: HH:MM:SS or seconds)

**Response:**
```json
{
  "jobId": 1,
  "status": "queued",
  "position": 1,
  "wsUrl": "/ws/download/1"
}
```

### Batch Download

```bash
POST /api/download/batch
Content-Type: application/json

{
  "items": [
    { "url": "...", "formatId": "1080p" },
    { "url": "...", "extractAudio": true }
  ],
  "formatId": "best"
}
```

### Queue Management

```bash
# Get queue status
GET /api/queue

# Get job details
GET /api/queue/:jobId

# Cancel job
DELETE /api/queue/:jobId

# Retry failed job
POST /api/queue/:jobId/retry

# Clear completed
DELETE /api/queue
```

## WebSocket

Connect to receive real-time progress:

```javascript
const ws = new WebSocket('ws://localhost:3000/ws/download/{jobId}');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  if (data.type === 'progress') {
    console.log(data.data.percent, data.data.speed);
  }
  
  if (data.type === 'complete') {
    console.log('Download complete!');
  }
  
  if (data.type === 'error') {
    console.error('Error:', data.error);
  }
};
```

## Architecture

```
┌─────────┐      HTTP/WS       ┌─────────────┐      Spawn      ┌─────────┐
│ Client  │ ◄────────────────► │ Express API │ ───────────────► │ yt-dlp  │
└─────────┘                    │  - Bull Queue              │   │         │
                               │  - WebSocket progress      │   │         │
                               └─────────────┘              └─────────┘
                                      │
                                      ▼
                               ┌─────────────┐
                               │    Redis    │
                               └─────────────┘
```

## Project Structure

```
arcdlp-api/
├── config/
│   ├── constants.js      # App constants
│   └── redis.js          # Redis connection
├── middleware/
│   ├── auth.js           # API key auth
│   ├── rateLimiter.js    # Rate limiting
│   └── errorHandler.js   # Error handling
├── routes/
│   ├── download.js       # Download endpoints
│   ├── queue.js          # Queue management
│   └── health.js         # Health checks
├── services/
│   ├── ytdlpService.js   # yt-dlp integration
│   └── queueService.js   # Bull queue wrapper
├── websocket/
│   └── progressHandler.js # WebSocket setup
├── src/
│   └── app.js            # Entry point
├── .env.example
└── package.json
```

## License

MIT
