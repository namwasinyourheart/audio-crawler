const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Spawn options - don't use shell: true as it breaks argument escaping
function getSpawnOptions() {
    return {};
}

function getFfmpegPath() {
    const ext = process.platform === 'win32' ? '.exe' : '';
    
    // Try bundled ffmpeg-static first
    try {
        const ffmpegStatic = require('ffmpeg-static');
        if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
            console.log('Using ffmpeg-static:', ffmpegStatic);
            return ffmpegStatic;
        }
    } catch (err) {
        console.log('ffmpeg-static not available:', err.message);
    }
    
    // Try system ffmpeg
    console.log('Falling back to system ffmpeg');
    return 'ffmpeg';
}

function getYtdlpPath() {
    const ext = process.platform === 'win32' ? '.exe' : '';
    const binary = 'yt-dlp' + ext;
    
    const candidates = [
        path.join(process.cwd(), 'bin', binary),
        path.join(__dirname, '..', '..', 'arcdlp', 'bin', binary),
        binary
    ];
    
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return binary;
}

function checkDeps() {
    const ytdlp = getYtdlpPath();
    const ffmpeg = getFfmpegPath();
    return {
        ytdlp: { found: fs.existsSync(ytdlp), path: ytdlp },
        ffmpeg: { found: ffmpeg !== 'ffmpeg', path: ffmpeg }
    };
}

function cleanInfo(raw) {
    const formats = (raw.formats || []).map((f) => ({
        format_id: f.format_id,
        ext: f.ext,
        height: f.height || null,
        fps: f.fps || null,
        vcodec: f.vcodec || 'none',
        acodec: f.acodec || 'none',
        filesize: f.filesize || f.filesize_approx || null,
        tbr: f.tbr || null,
        format_note: f.format_note || '',
    }));

    return {
        id: raw.id,
        title: raw.title || raw.id,
        thumbnail: raw.thumbnail || null,
        duration: raw.duration || null,
        duration_string: raw.duration_string || null,
        uploader: raw.uploader || raw.channel || '',
        uploader_id: raw.uploader_id || raw.channel_id || '',
        webpage_url: raw.webpage_url || '',
        extractor_key: raw.extractor_key || '',
        formats,
    };
}

function buildPresets(formats) {
    const heightSet = new Set();
    for (const f of formats) {
        if (f.height) heightSet.add(f.height);
    }
    const heights = [...heightSet].sort((a, b) => b - a);
    const tags = { 2160: '4K', 1440: '2K', 1080: 'Full HD', 720: 'HD' };

    function estimateSize(h) {
        const matching = formats.filter((f) => f.height === h && f.filesize);
        if (matching.length === 0) return null;
        return Math.max(...matching.map((f) => f.filesize));
    }

    function formatBytes(bytes) {
        if (!bytes) return null;
        if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
        if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
        return (bytes / 1e3).toFixed(0) + ' KB';
    }

    const presets = [];

    if (heights.length > 0) {
        presets.push({
            id: 'best',
            label: 'Best',
            tag: '',
            size: null,
            formatId: 'bestvideo+bestaudio/best',
            type: 'video',
        });
    }

    for (const h of heights) {
        presets.push({
            id: `${h}p`,
            label: `${h}p`,
            tag: tags[h] || '',
            size: formatBytes(estimateSize(h)),
            formatId: `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]`,
            type: 'video',
        });
    }

    const audioBest = formats
        .filter((f) => f.vcodec === 'none' && f.acodec !== 'none' && f.filesize)
        .sort((a, b) => (b.tbr || 0) - (a.tbr || 0))[0];

    presets.push({
        id: 'audio',
        label: 'MP3',
        tag: '256 Kb/s',
        size: formatBytes(audioBest?.filesize),
        formatId: 'bestaudio/best',
        type: 'audio',
    });

    return presets;
}

function fetchInfo(url) {
    return new Promise((resolve, reject) => {
        const ytdlp = getYtdlpPath();
        const args = ['--dump-json', '--no-playlist', '--no-warnings', '--socket-timeout', '30'];
        const ffmpeg = getFfmpegPath();
        if (ffmpeg && ffmpeg !== 'ffmpeg') {
            args.push('--ffmpeg-location', path.dirname(ffmpeg));
        }
        args.push(url);

        const proc = spawn(ytdlp, args, getSpawnOptions());
        let stdout = '';
        let stderr = '';
        let killed = false;

        const timer = setTimeout(() => {
            killed = true;
            try { proc.kill('SIGTERM'); } catch {}
            reject(new Error('Fetch timed out after 60 seconds'));
        }, 60000);

        proc.stdout.on('data', (d) => {
            stdout += d.toString();
        });

        proc.stderr.on('data', (d) => {
            stderr += d.toString();
        });

        proc.on('close', (code) => {
            clearTimeout(timer);
            if (killed) return;

            if (code !== 0) {
                const msg = stderr.trim() || `yt-dlp exited with code ${code}`;
                return reject(new Error(msg));
            }

            try {
                const raw = JSON.parse(stdout);
                const info = cleanInfo(raw);
                const presets = buildPresets(info.formats);
                resolve({ info, presets, raw });
            } catch (e) {
                reject(new Error('Failed to parse video info'));
            }
        });

        proc.on('error', (err) => {
            clearTimeout(timer);
            reject(new Error(`Cannot run yt-dlp: ${err.message}`));
        });
    });
}

function download(jobData, callbacks) {
    const { url, formatId, outputDir, extractAudio, audioFormat, startTime, endTime } = jobData;
    const { onProgress, onLog, onComplete, onError } = callbacks;

    return new Promise((resolve, reject) => {
        const ytdlp = getYtdlpPath();
        
        // Build output filename with time range if specified
        let outputTemplate = '%(title)s [%(id)s].%(ext)s';
        if (startTime || endTime) {
            const timeRange = [];
            if (startTime) timeRange.push(startTime);
            if (endTime) timeRange.push(endTime);
            const timeStr = timeRange.join('-');
            outputTemplate = `%(title)s [%(id)s] (${timeStr}).%(ext)s`;
        }
        
        const args = [
            '--newline',
            '--no-warnings',
            '--socket-timeout', '30',
            '--progress-template', 'download:DLPROG %(progress._percent_str)s %(progress._speed_str)s %(progress._eta_str)s',
            '-o', path.join(outputDir, outputTemplate),
        ];

        const ffmpeg = getFfmpegPath();
        if (ffmpeg && ffmpeg !== 'ffmpeg') {
            args.push('--ffmpeg-location', path.dirname(ffmpeg));
        }

        // Add time trimming if specified
        if (startTime || endTime) {
            const postprocArgs = [];
            if (startTime) postprocArgs.push(`-ss ${startTime}`);
            if (endTime) postprocArgs.push(`-to ${endTime}`);
            args.push('--postprocessor-args', `ffmpeg:${postprocArgs.join(' ')}`);
        }

        if (extractAudio) {
            args.push('-x', '--audio-format', audioFormat || 'mp3');
        } else if (formatId) {
            args.push('-f', formatId, '--merge-output-format', 'mp4');
            if (!startTime && !endTime) {
                args.push('--postprocessor-args', 'ffmpeg:-c:v copy -c:a aac');
            }
        }

        args.push(url);

        const proc = spawn(ytdlp, args, getSpawnOptions());
        callbacks._proc = proc;

        function parseOutput(data) {
            const text = data.toString();
            const lines = text.split('\n');
            for (const line of lines) {
                if (line.startsWith('DLPROG ')) {
                    const parts = line.slice(7).trim().split(/\s+/);
                    const percent = (parts[0] || '0%').trim();
                    const speed = (parts[1] || '').trim();
                    const eta = (parts[2] || '').trim();
                    onProgress({ percent, speed, eta });
                    continue;
                }

                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('WARNING')) {
                    if (trimmed.startsWith('[download]') ||
                        trimmed.startsWith('[Merger]') ||
                        trimmed.startsWith('[ExtractAudio]') ||
                        trimmed.startsWith('[info]')) {
                        onLog(trimmed);
                    }
                }
            }
        }

        let stderrFull = '';
        
        proc.stdout.on('data', parseOutput);
        proc.stderr.on('data', (data) => {
            const text = data.toString();
            stderrFull += text;
            parseOutput(data);
        });

        proc.on('close', (code) => {
            if (code !== 0) {
                console.error('yt-dlp stderr:', stderrFull);
                return reject(new Error(`Download failed with code ${code}\n${stderrFull}`));
            }
            onComplete();
            resolve({ ok: true });
        });

        proc.on('error', (err) => {
            reject(new Error(`Cannot run yt-dlp: ${err.message}`));
        });
    });
}

function looksLikePlaylist(url) {
    if (!url) return false;
    const u = url.toLowerCase();
    if (u.includes('list=')) return true;
    if (u.includes('/playlist')) return true;
    if (u.includes('/sets/')) return true;
    if (u.includes('/album/') || u.includes('/albums/')) return true;
    if (u.includes('instagram.com') && u.includes('/saved/')) return true;

    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase();
        const pathname = parsed.pathname.toLowerCase();

        if (hostname.includes('youtube.com')) {
            if (pathname.includes('/channel/') || pathname.includes('/c/')) return true;
            if (pathname.startsWith('/@') && !pathname.includes('/video/')) return true;
        }
    } catch {}

    return false;
}

async function fetchPlaylist(url, { onItem } = {}) {
    const ytdlp = getYtdlpPath();
    const args = ['--flat-playlist', '--dump-json', '--no-warnings', '--socket-timeout', '30'];
    const ffmpeg = getFfmpegPath();
    if (ffmpeg && ffmpeg !== 'ffmpeg') {
        args.push('--ffmpeg-location', path.dirname(ffmpeg));
    }
    args.push(url);

    return new Promise((resolve, reject) => {
        const proc = spawn(ytdlp, args, getSpawnOptions());
        let stderr = '';
        const items = [];
        let buffer = '';
        let killed = false;

        const timer = setTimeout(() => {
            killed = true;
            try { proc.kill('SIGTERM'); } catch {}
            if (items.length > 0) {
                resolve({ items });
            } else {
                reject(new Error('Playlist fetch timed out'));
            }
        }, 180000);

        proc.stdout.on('data', (d) => {
            buffer += d.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                    const raw = JSON.parse(trimmed);
                    const item = {
                        id: raw.id || '',
                        title: raw.title || raw.id || 'Untitled',
                        url: raw.url || raw.webpage_url || '',
                        webpage_url: raw.webpage_url || raw.url || '',
                        duration: raw.duration || null,
                        thumbnail: raw.thumbnails?.[0]?.url || raw.thumbnail || null,
                        uploader: raw.uploader || raw.channel || '',
                        extractor_key: raw.ie_key || raw.extractor_key || '',
                    };
                    items.push(item);
                    if (onItem) onItem(item, items.length);
                } catch {}
            }
        });

        proc.stderr.on('data', (d) => {
            stderr += d.toString();
        });

        proc.on('close', (code) => {
            clearTimeout(timer);
            if (killed) return;

            if (buffer.trim()) {
                try {
                    const raw = JSON.parse(buffer.trim());
                    const item = {
                        id: raw.id || '',
                        title: raw.title || raw.id || 'Untitled',
                        url: raw.url || raw.webpage_url || '',
                        webpage_url: raw.webpage_url || raw.url || '',
                        duration: raw.duration || null,
                        thumbnail: raw.thumbnails?.[0]?.url || raw.thumbnail || null,
                        uploader: raw.uploader || raw.channel || '',
                        extractor_key: raw.ie_key || raw.extractor_key || '',
                    };
                    items.push(item);
                } catch {}
            }

            if (code !== 0 && items.length === 0) {
                return reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
            }
            resolve({ items });
        });

        proc.on('error', (err) => {
            clearTimeout(timer);
            reject(new Error(`Cannot run yt-dlp: ${err.message}`));
        });
    });
}

module.exports = {
    checkDeps,
    fetchInfo,
    fetchPlaylist,
    looksLikePlaylist,
    buildPresets,
    download,
};
