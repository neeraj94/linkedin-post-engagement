document.addEventListener('DOMContentLoaded', function() {
    // Get DOM elements
    const commentText = document.getElementById('commentText');
    const textInput = document.getElementById('textInput');
    const minDelay = document.getElementById('minDelay');
    const maxDelay = document.getElementById('maxDelay');
    const urlTimeout = document.getElementById('urlTimeout');
    const retryLimit = document.getElementById('retryLimit');
    const dryRunCheckbox = document.getElementById('dryRun');
    const enableLikeCheckbox = document.getElementById('enableLike');
    const enableCommentCheckbox = document.getElementById('enableComment');
    
    const startBtn = document.getElementById('startBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const stopBtn = document.getElementById('stopBtn');
    const exportBtn = document.getElementById('exportBtn');
    
    const status = document.getElementById('status');
    const currentUrlDisplay = document.getElementById('currentUrl');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const counters = document.getElementById('counters');
    const extractedUrls = document.getElementById('extractedUrls');
    
    const activityLog = document.getElementById('activityLog');
    const logContent = document.getElementById('logContent');
    const logFilterButtons = document.getElementById('logFilterButtons');
    const clearLogBtn = document.getElementById('clearLogBtn');
    const exportLogBtn = document.getElementById('exportLogBtn');
    
    const userInfo = document.getElementById('userInfo');

    // State variables
    let isRunning = false;
    let isPaused = false;
    let currentUrls = [];
    let currentIndex = 0;
    let automationState = null;
    let logFilter = 'all'; // all, info, success, error, warning
    let allLogs = [];

    // Load saved data
    loadSavedData();

    // Set up event listeners
    setupEventListeners();

    // Check automation status on popup open
    checkAutomationStatus();

    // Get LinkedIn user info
    getLinkedInUserInfo();

    function loadSavedData() {
        chrome.storage.sync.get([
            'commentText', 'textInput', 'minDelay', 'maxDelay', 
            'urlTimeout', 'retryLimit', 'dryRun', 'enableLike', 'enableComment'
        ], function(data) {
            if (data.commentText) commentText.value = data.commentText;
            if (data.textInput) {
                textInput.value = data.textInput;
                extractLinkedInUrls();
            }
            minDelay.value = data.minDelay || 2;
            maxDelay.value = data.maxDelay || 5;
            urlTimeout.value = data.urlTimeout || 30;
            retryLimit.value = data.retryLimit || 2;
            dryRunCheckbox.checked = data.dryRun || false;
            enableLikeCheckbox.checked = data.enableLike !== false;
            enableCommentCheckbox.checked = data.enableComment !== false;
        });
    }

    function setupEventListeners() {
        // Input event listeners with data persistence
        commentText.addEventListener('input', () => {
            chrome.storage.sync.set({commentText: commentText.value});
        });

        textInput.addEventListener('input', () => {
            chrome.storage.sync.set({textInput: textInput.value});
            extractLinkedInUrls();
        });

        minDelay.addEventListener('input', () => {
            chrome.storage.sync.set({minDelay: minDelay.value});
        });

        maxDelay.addEventListener('input', () => {
            chrome.storage.sync.set({maxDelay: maxDelay.value});
        });

        urlTimeout.addEventListener('input', () => {
            chrome.storage.sync.set({urlTimeout: urlTimeout.value});
        });

        retryLimit.addEventListener('input', () => {
            chrome.storage.sync.set({retryLimit: retryLimit.value});
        });

        dryRunCheckbox.addEventListener('change', () => {
            chrome.storage.sync.set({dryRun: dryRunCheckbox.checked});
        });

        enableLikeCheckbox.addEventListener('change', () => {
            chrome.storage.sync.set({enableLike: enableLikeCheckbox.checked});
        });

        enableCommentCheckbox.addEventListener('change', () => {
            chrome.storage.sync.set({enableComment: enableCommentCheckbox.checked});
        });

        // Control button listeners
        startBtn.addEventListener('click', startAutomation);
        pauseBtn.addEventListener('click', pauseAutomation);
        stopBtn.addEventListener('click', stopAutomation);
        exportBtn.addEventListener('click', exportData);

        // Log control listeners
        clearLogBtn.addEventListener('click', clearLogs);
        exportLogBtn.addEventListener('click', exportLogs);

        // Log filter buttons
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                setLogFilter(e.target.dataset.filter);
            });
        });

        // Current URL click handler
        currentUrlDisplay.addEventListener('click', openCurrentUrl);
    }

    function extractLinkedInUrls() {
        const text = textInput.value;
        const urlRegex = /https?:\/\/(?:(?:www\.)?linkedin\.com\/(?:posts|feed\/update|in)\/[^\s\]]+|lnkd\.in\/[^\s\]]+)/gi;
        const urls = text.match(urlRegex) || [];
        
        const cleanUrls = urls.map(url => url.replace(/[,.\])\s]*$/, '').trim());
        const uniqueUrls = [...new Set(cleanUrls)];
        currentUrls = uniqueUrls;
        
        if (uniqueUrls.length > 0) {
            extractedUrls.innerHTML = `
                <strong>Found ${uniqueUrls.length} LinkedIn URLs:</strong><br>
                ${uniqueUrls.map((url, index) => `
                    <div class="url-item">
                        <span class="url-index">${index + 1}.</span>
                        <span class="url-text" title="${url}">${url.length > 50 ? url.substring(0, 50) + '...' : url}</span>
                    </div>
                `).join('')}
            `;
        } else {
            extractedUrls.innerHTML = '<span class="no-urls">No LinkedIn URLs found in the text.</span>';
        }
    }

    function startAutomation() {
        const comment = commentText.value.trim();
        const minDelayVal = parseInt(minDelay.value) || 2;
        const maxDelayVal = parseInt(maxDelay.value) || 5;
        const urlTimeoutVal = parseInt(urlTimeout.value) || 30;
        const retryLimitVal = parseInt(retryLimit.value) || 2;
        const isDryRun = dryRunCheckbox.checked;
        const shouldLike = enableLikeCheckbox.checked;
        const shouldComment = enableCommentCheckbox.checked;

        // Validation
        if (!shouldLike && !shouldComment) {
            updateStatus('Please select at least one action: Like or Comment', 'error');
            return;
        }

        if (!comment && shouldComment && !isDryRun) {
            updateStatus('Please enter a comment text or disable commenting', 'error');
            return;
        }

        if (currentUrls.length === 0) {
            updateStatus('Please add text with LinkedIn URLs', 'error');
            return;
        }

        if (minDelayVal > maxDelayVal) {
            updateStatus('Min delay cannot be greater than max delay', 'error');
            return;
        }

        // Start automation
        currentIndex = 0;
        isRunning = true;
        isPaused = false;

        updateUIForRunning();
        updateStatus('Starting automation...', 'running');
        updateCounters(0, 0, 0, 0);
        
        addLogEntry(`Started automation with ${currentUrls.length} URLs`, 'success');
        addLogEntry(`Settings: ${minDelayVal}-${maxDelayVal}s delay, ${urlTimeoutVal}s timeout, ${retryLimitVal} retries${isDryRun ? ', DRY-RUN MODE' : ''}`, 'info');

        // Send message to background script
        chrome.runtime.sendMessage({
            action: 'startAutomation',
            comment: comment,
            urls: currentUrls,
            minDelay: minDelayVal,
            maxDelay: maxDelayVal,
            urlTimeout: urlTimeoutVal,
            retryLimit: retryLimitVal,
            dryRun: isDryRun,
            enableLike: shouldLike,
            enableComment: shouldComment
        });
    }

    function pauseAutomation() {
        if (isPaused) {
            // Resume
            chrome.runtime.sendMessage({action: 'resumeAutomation'});
            isPaused = false;
            pauseBtn.textContent = 'Pause';
            updateStatus('Automation resumed', 'running');
            addLogEntry('Automation resumed', 'info');
        } else {
            // Pause
            chrome.runtime.sendMessage({action: 'pauseAutomation'});
            isPaused = true;
            pauseBtn.textContent = 'Resume';
            updateStatus('Automation paused', 'paused');
            addLogEntry('Automation paused', 'warning');
        }
    }

    function stopAutomation() {
        chrome.runtime.sendMessage({action: 'stopAutomation'});
        resetUI();
        updateStatus('Automation stopped', 'idle');
        updateProgress('');
        addLogEntry('Automation stopped by user', 'warning');
    }

    function exportData() {
        if (!automationState) {
            addLogEntry('No automation data to export', 'warning');
            return;
        }

        const data = {
            urls: currentUrls,
            stats: automationState.stats,
            settings: {
                comment: commentText.value,
                minDelay: minDelay.value,
                maxDelay: maxDelay.value,
                urlTimeout: urlTimeout.value,
                retryLimit: retryLimit.value,
                dryRun: dryRunCheckbox.checked
            },
            timestamp: new Date().toISOString()
        };

        downloadJSON(data, `linkedin-automation-${Date.now()}.json`);
        addLogEntry('Automation data exported', 'success');
    }

    function checkAutomationStatus() {
        chrome.runtime.sendMessage({action: 'getStatus'}, function(state) {
            if (state && state.isRunning) {
                automationState = state;
                currentUrls = state.urls;
                currentIndex = state.currentIndex;
                isRunning = true;
                isPaused = state.isPaused || false;
                
                updateUIForRunning();
                updateProgress(state.stats);
                updateCurrentUrl(state.currentUrl);
                
                if (isPaused) {
                    pauseBtn.textContent = 'Resume';
                    updateStatus('Automation paused', 'paused');
                } else {
                    updateStatus(`Running: ${currentIndex + 1}/${currentUrls.length} posts`, 'running');
                }

                // Load recent logs
                if (state.recentLogs) {
                    state.recentLogs.forEach(log => {
                        addLogEntry(log.message, log.type, false);
                    });
                }
            }
        });
    }

    function getLinkedInUserInfo() {
        // This would need to be implemented based on how we can access LinkedIn user info
        // For now, show a placeholder
        userInfo.innerHTML = `
            <div class="user-placeholder">
                <div class="user-avatar">👤</div>
                <div class="user-details">
                    <div class="user-name">LinkedIn User</div>
                    <div class="user-status">Connected</div>
                </div>
            </div>
        `;
    }

    function updateUIForRunning() {
        startBtn.style.display = 'none';
        pauseBtn.style.display = 'inline-block';
        stopBtn.style.display = 'inline-block';
        activityLog.style.display = 'block';
        
        // Disable form inputs during automation
        commentText.disabled = true;
        textInput.disabled = true;
        minDelay.disabled = true;
        maxDelay.disabled = true;
        urlTimeout.disabled = true;
        retryLimit.disabled = true;
        dryRunCheckbox.disabled = true;
    }

    function resetUI() {
        isRunning = false;
        isPaused = false;
        startBtn.style.display = 'inline-block';
        pauseBtn.style.display = 'none';
        stopBtn.style.display = 'none';
        pauseBtn.textContent = 'Pause';
        
        // Re-enable form inputs
        commentText.disabled = false;
        textInput.disabled = false;
        minDelay.disabled = false;
        maxDelay.disabled = false;
        urlTimeout.disabled = false;
        retryLimit.disabled = false;
        dryRunCheckbox.disabled = false;
        
        updateCurrentUrl('');
        updateProgress({ processed: 0, total: 0, liked: 0, commented: 0, skipped: 0, failed: 0 });
    }

    function updateStatus(text, type) {
        status.textContent = text;
        status.className = `status ${type}`;
    }

    function updateProgress(stats) {
        if (!stats || typeof stats !== 'object') {
            progressBar.style.width = '0%';
            progressText.textContent = '';
            return;
        }

        const { processed = 0, total = 0, liked = 0, commented = 0, skipped = 0, failed = 0 } = stats;
        
        const progressPercent = total > 0 ? (processed / total) * 100 : 0;
        progressBar.style.width = `${progressPercent}%`;
        progressText.textContent = `${processed}/${total} posts processed`;
        
        updateCounters(liked, commented, skipped, failed);
    }

    function updateCounters(liked, commented, skipped, failed) {
        counters.innerHTML = `
            <div class="counter-item liked">
                <span class="counter-label">Liked:</span>
                <span class="counter-value">${liked}</span>
            </div>
            <div class="counter-item commented">
                <span class="counter-label">Commented:</span>
                <span class="counter-value">${commented}</span>
            </div>
            <div class="counter-item skipped">
                <span class="counter-label">Skipped:</span>
                <span class="counter-value">${skipped}</span>
            </div>
            <div class="counter-item failed">
                <span class="counter-label">Failed:</span>
                <span class="counter-value">${failed}</span>
            </div>
        `;
    }

    function updateCurrentUrl(url) {
        if (url) {
            currentUrlDisplay.innerHTML = `
                <strong>Current:</strong>
                <span class="current-url-link" title="${url}">${url.length > 60 ? url.substring(0, 60) + '...' : url}</span>
                <span class="open-icon">🔗</span>
            `;
            currentUrlDisplay.style.display = 'block';
        } else {
            currentUrlDisplay.style.display = 'none';
        }
    }

    function openCurrentUrl() {
        if (automationState && automationState.currentUrl) {
            chrome.tabs.create({ url: automationState.currentUrl });
        }
    }

    function addLogEntry(message, type = 'info', store = true) {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = {
            message,
            type,
            timestamp: new Date(),
            timestampStr: timestamp
        };

        if (store) {
            allLogs.push(logEntry);
        }

        // Apply filter
        if (logFilter === 'all' || logFilter === type) {
            displayLogEntry(logEntry);
        }
    }

    function displayLogEntry(logEntry) {
        const logElement = document.createElement('div');
        logElement.className = `log-entry log-${logEntry.type}`;
        logElement.innerHTML = `
            <span class="log-timestamp">[${logEntry.timestampStr}]</span>
            <span class="log-message">${logEntry.message}</span>
        `;
        logContent.appendChild(logElement);
        logContent.scrollTop = logContent.scrollHeight;
    }

    function setLogFilter(filter) {
        logFilter = filter;
        
        // Update button states
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });

        // Re-render logs
        logContent.innerHTML = '';
        allLogs.forEach(log => {
            if (filter === 'all' || filter === log.type) {
                displayLogEntry(log);
            }
        });
    }

    function clearLogs() {
        allLogs = [];
        logContent.innerHTML = '';
        addLogEntry('Logs cleared', 'info');
    }

    function exportLogs() {
        if (allLogs.length === 0) {
            addLogEntry('No logs to export', 'warning');
            return;
        }

        // Export as CSV
        const csvContent = [
            'Timestamp,Type,Message',
            ...allLogs.map(log => `"${log.timestamp.toISOString()}","${log.type}","${log.message.replace(/"/g, '""')}"`)
        ].join('\n');

        downloadCSV(csvContent, `linkedin-automation-logs-${Date.now()}.csv`);
        addLogEntry('Logs exported to CSV', 'success');
    }

    function downloadCSV(content, filename) {
        const blob = new Blob([content], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    function downloadJSON(data, filename) {
        const content = JSON.stringify(data, null, 2);
        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    // Listen for messages from background script
    chrome.runtime.onMessage.addListener(function(message) {
        switch (message.action) {
            case 'updateProgress':
                currentIndex = message.index;
                automationState = message.state;
                updateProgress(message.state.stats);
                updateCurrentUrl(message.state.currentUrl);
                updateStatus(`Processing ${currentIndex + 1}/${currentUrls.length} posts`, 'running');
                break;

            case 'postProcessed':
                const { url, status: postStatus, liked, commented, skipped, error, errorCode } = message;
                let logMessage = `Post ${currentIndex + 1}: ${postStatus}`;
                let logType = 'info';

                if (error) {
                    logMessage += ` (${errorCode || 'ERROR'})`;
                    logType = 'error';
                } else if (skipped) {
                    logType = 'warning';
                } else if (liked || commented) {
                    logType = 'success';
                }

                addLogEntry(logMessage, logType);
                break;

            case 'automationComplete':
                resetUI();
                updateStatus('Automation completed successfully!', 'idle');
                addLogEntry('Automation completed successfully!', 'success');
                if (message.stats) {
                    addLogEntry(`Final stats: ${message.stats.liked} liked, ${message.stats.commented} commented, ${message.stats.skipped} skipped, ${message.stats.failed} failed`, 'info');
                }
                break;

            case 'automationError':
                resetUI();
                updateStatus(`Error: ${message.error}`, 'error');
                addLogEntry(`Automation error: ${message.error}`, 'error');
                break;

            case 'logMessage':
                addLogEntry(message.message, message.type || 'info');
                break;

            case 'urlTimeout':
                addLogEntry(`URL timeout: ${message.url} (${message.timeout}s)`, 'error');
                break;

            case 'retryAttempt':
                addLogEntry(`Retry attempt ${message.attempt}/${message.maxRetries} for URL: ${message.url}`, 'warning');
                break;
        }
    });
});