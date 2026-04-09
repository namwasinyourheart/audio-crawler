const https = require('https');
const fs = require('fs');
const path = require('path');

const binDir = path.join(__dirname, '..', 'bin');
const platform = process.platform;
const isWin = platform === 'win32';
const ext = isWin ? '.exe' : '';
const binaryName = 'yt-dlp' + ext;
const binaryPath = path.join(binDir, binaryName);

const releaseUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp${isWin ? '.exe' : ''}`;

async function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, { redirect: 'follow' }, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                https.get(response.headers.location, (res) => {
                    res.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        resolve();
                    });
                }).on('error', reject);
            } else {
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            }
        }).on('error', reject);
    });
}

async function main() {
    if (!fs.existsSync(binDir)) {
        fs.mkdirSync(binDir, { recursive: true });
    }

    if (fs.existsSync(binaryPath)) {
        console.log('yt-dlp already exists, skipping download');
        return;
    }

    console.log(`Downloading yt-dlp for ${platform}...`);
    console.log(`URL: ${releaseUrl}`);
    
    try {
        await downloadFile(releaseUrl, binaryPath);
        if (!isWin) {
            fs.chmodSync(binaryPath, 0o755);
        }
        console.log(`yt-dlp downloaded to ${binaryPath}`);
    } catch (err) {
        console.error('Failed to download yt-dlp:', err.message);
        console.log('Please download manually from https://github.com/yt-dlp/yt-dlp/releases');
        process.exit(1);
    }
}

main();
