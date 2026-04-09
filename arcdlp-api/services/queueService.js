const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { DOWNLOAD_PATH } = require('../config/constants');
const ytdlpService = require('./ytdlpService');

const STATE = {
    PENDING: 'pending',
    DOWNLOADING: 'downloading',
    COMPLETED: 'completed',
    FAILED: 'failed',
};

class DownloadQueue {
    constructor() {
        this._items = [];
        this._isProcessing = false;
        this._aborted = false;
        this._callbacks = null;
        this._currentProc = null;
        this._idCounter = 0;
        this._downloadPath = DOWNLOAD_PATH;
        this._wsConnections = new Map();
    }

    setCallbacks(cbs) {
        this._callbacks = cbs;
    }

    setDownloadPath(p) {
        this._downloadPath = p;
    }

    setWsConnection(jobId, ws) {
        this._wsConnections.set(jobId, ws);
    }

    removeWsConnection(jobId) {
        this._wsConnections.delete(jobId);
    }

    _sendWs(jobId, type, data) {
        const ws = this._wsConnections.get(jobId);
        if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({ type, data }));
        }
    }

    add(items) {
        const added = [];
        for (const item of items) {
            const qItem = {
                id: ++this._idCounter,
                url: item.url,
                title: item.title || 'Untitled',
                thumbnail: item.thumbnail || null,
                formatId: item.formatId,
                extractAudio: item.extractAudio || false,
                audioFormat: item.audioFormat || 'mp3',
                startTime: item.startTime || null,
                endTime: item.endTime || null,
                state: STATE.PENDING,
                error: null,
                progress: null,
                addedAt: Date.now(),
            };
            this._items.push(qItem);
            added.push(qItem);
            console.log(`Queue: added ${qItem.title} -> ${qItem.id}`);
        }

        this._emitQueueUpdate();

        if (!this._isProcessing) {
            this._processNext();
        }

        return added;
    }

    getAll() {
        return this._items.map((item) => ({ ...item }));
    }

    cancelCurrent() {
        if (this._currentProc) {
            console.log('Queue: cancelling current');
            this._cancelled = true;
            try {
                this._currentProc.kill('SIGTERM');
            } catch {}
            this._currentProc = null;
        }
    }

    cancelAll() {
        console.log('Queue: cancel all');
        this._aborted = true;
        this.cancelCurrent();

        for (const item of this._items) {
            if (item.state === STATE.PENDING) {
                item.state = STATE.FAILED;
                item.error = 'Cancelled';
            }
        }

        this._isProcessing = false;
        this._emitQueueUpdate();
    }

    retry(itemId) {
        const item = this._items.find((i) => i.id === itemId);
        if (!item || item.state !== STATE.FAILED) return;

        console.log(`Queue: retrying ${item.title}`);
        item.state = STATE.PENDING;
        item.error = null;
        item.progress = null;
        this._emitQueueUpdate();

        if (!this._isProcessing) {
            this._processNext();
        }
    }

    retryFailed() {
        let count = 0;
        for (const item of this._items) {
            if (item.state === STATE.FAILED) {
                item.state = STATE.PENDING;
                item.error = null;
                item.progress = null;
                count++;
            }
        }
        console.log(`Queue: retrying ${count} failed items`);
        this._emitQueueUpdate();

        if (!this._isProcessing && count > 0) {
            this._processNext();
        }
    }

    clearCompleted() {
        this._items = this._items.filter((i) => i.state === STATE.PENDING || i.state === STATE.DOWNLOADING);
        if (this._items.length === 0) this._idCounter = 0;
        this._emitQueueUpdate();
    }

    remove(itemId) {
        const item = this._items.find((i) => i.id === itemId);
        if (!item) return;

        if (item.state === STATE.DOWNLOADING) {
            this.cancelCurrent();
        }

        this._items = this._items.filter((i) => i.id !== itemId);
        this._emitQueueUpdate();
    }

    get isActive() {
        return this._isProcessing;
    }

    get counts() {
        let pending = 0, downloading = 0, completed = 0, failed = 0;
        for (const item of this._items) {
            if (item.state === STATE.PENDING) pending++;
            else if (item.state === STATE.DOWNLOADING) downloading++;
            else if (item.state === STATE.COMPLETED) completed++;
            else if (item.state === STATE.FAILED) failed++;
        }
        return { total: this._items.length, pending, downloading, completed, failed };
    }

    async _processNext() {
        if (this._aborted) {
            this._aborted = false;
            this._isProcessing = false;
            return;
        }

        const nextItem = this._items.find((i) => i.state === STATE.PENDING);
        if (!nextItem) {
            this._isProcessing = false;
            console.log('Queue: all done');
            this._emit('log', 'Queue complete');
            this._emitQueueUpdate();
            return;
        }

        this._isProcessing = true;
        nextItem.state = STATE.DOWNLOADING;
        nextItem.progress = { percent: '0%', speed: '', eta: '' };
        this._emitItemUpdate(nextItem);
        this._emitQueueUpdate();

        const counts = this.counts;
        const position = counts.completed + counts.failed + 1;
        const total = counts.total;
        this._emit('log', `Downloading ${position}/${total}: ${nextItem.title}`);

        try {
            this._cancelled = false;
            await this._downloadOne(nextItem);
            nextItem.state = STATE.COMPLETED;
            nextItem.progress = { percent: '100%', speed: '', eta: '' };
            this._emit('log', `Completed: ${nextItem.title} ✓`);
            console.log(`Queue: completed ${nextItem.title}`);
            this._sendWs(nextItem.id, 'complete', { jobId: nextItem.id, title: nextItem.title });
        } catch (err) {
            if (this._cancelled) {
                nextItem.state = STATE.FAILED;
                nextItem.error = 'Cancelled';
                this._emit('log', `Skipped: ${nextItem.title}`);
                console.log(`Queue: cancelled ${nextItem.title}`);
            } else {
                nextItem.state = STATE.FAILED;
                nextItem.error = err.message || 'Download failed';
                this._emit('log', `Failed: ${nextItem.title} - ${nextItem.error}`);
                console.error(`Queue: failed ${nextItem.title}`, err.message);
                this._sendWs(nextItem.id, 'error', { error: nextItem.error });
            }
            this._cancelled = false;
        }

        this._currentProc = null;
        this._emitItemUpdate(nextItem);
        this._emitQueueUpdate();

        setTimeout(() => this._processNext(), 0);
    }

    async _downloadOne(item) {
        const outputDir = this._downloadPath;
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const callbacks = {
            onProgress: (p) => {
                item.progress = p;
                this._emitItemUpdate(item);
                this._sendWs(item.id, 'progress', p);
            },
            onLog: (msg) => {
                this._emit('log', msg);
            },
            onComplete: () => {
                this._sendWs(item.id, 'complete', { jobId: item.id });
            },
            onError: (err) => {
                this._sendWs(item.id, 'error', { error: err.message });
            }
        };

        const downloadPromise = ytdlpService.download(
            {
                url: item.url,
                formatId: item.formatId,
                outputDir,
                extractAudio: item.extractAudio,
                audioFormat: item.audioFormat,
                startTime: item.startTime,
                endTime: item.endTime,
            },
            callbacks,
        );

        this._currentProc = callbacks._proc;

        const pollInterval = setInterval(() => {
            if (callbacks._proc) {
                this._currentProc = callbacks._proc;
                clearInterval(pollInterval);
            }
        }, 50);

        return downloadPromise.finally(() => clearInterval(pollInterval));
    }

    _emit(type, data) {
        if (!this._callbacks) return;
        if (type === 'log' && this._callbacks.onLog) {
            this._callbacks.onLog(data);
        }
    }

    _emitItemUpdate(item) {
        if (this._callbacks?.onItemUpdate) {
            this._callbacks.onItemUpdate({ ...item });
        }
    }

    _emitQueueUpdate() {
        if (this._callbacks?.onQueueUpdate) {
            this._callbacks.onQueueUpdate({
                items: this.getAll(),
                counts: this.counts,
                isActive: this.isActive,
            });
        }
    }
}

const queue = new DownloadQueue();

async function addToQueue(data) {
    const outputDir = data.outputDir || DOWNLOAD_PATH;
    const items = queue.add([{
        url: data.url,
        title: data.title || 'Download',
        formatId: data.formatId,
        extractAudio: data.extractAudio,
        audioFormat: data.audioFormat,
        thumbnail: data.thumbnail,
        startTime: data.startTime,
        endTime: data.endTime,
    }]);

    return {
        jobId: items[0].id,
        status: 'queued',
        position: queue.counts.pending + queue.counts.downloading,
    };
}

async function getQueueStatus() {
    const counts = queue.counts;
    const items = queue.getAll();
    return {
        counts,
        items,
    };
}

async function getJob(jobId) {
    const item = queue.getAll().find(i => i.id === parseInt(jobId));
    if (!item) return null;
    return item;
}

async function cancelJob(jobId) {
    queue.remove(parseInt(jobId));
    return true;
}

async function retryJob(jobId) {
    queue.retry(parseInt(jobId));
    const item = queue.getAll().find(i => i.id === parseInt(jobId));
    return { jobId: item.id, status: 'queued' };
}

async function clearCompleted() {
    queue.clearCompleted();
    return true;
}

module.exports = {
    queue,
    addToQueue,
    getQueueStatus,
    getJob,
    cancelJob,
    retryJob,
    clearCompleted,
    STATE,
};
