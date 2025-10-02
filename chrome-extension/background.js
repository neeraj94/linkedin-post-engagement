// Enhanced error codes for comprehensive diagnostics
const ERROR_CODES = {
    AUTH_401: 'AUTH_401',
    AUTH_EXPIRED: 'AUTH_EXPIRED', 
    RATE_LIMIT: 'RATE_LIMIT',
    NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
    DOM_NOT_FOUND: 'DOM_NOT_FOUND',
    ACTION_VERIFICATION_FAILED: 'ACTION_VERIFICATION_FAILED',
    TAB_CLOSED: 'TAB_CLOSED',
    CONTENT_SCRIPT_ERROR: 'CONTENT_SCRIPT_ERROR',
    UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

// Use chrome.storage to persist state across service worker suspensions
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.action === 'startAutomation') {
        startAutomation(message.comment, message.urls, message.minDelay, message.maxDelay, message.urlTimeout, message.retryLimit, message.dryRun, message.enableLike, message.enableComment);
    } else if (message.action === 'stopAutomation') {
        stopAutomation();
    } else if (message.action === 'pauseAutomation') {
        pauseAutomation();
    } else if (message.action === 'resumeAutomation') {
        resumeAutomation();
    } else if (message.action === 'postProcessed') {
        handlePostProcessed(message);
    } else if (message.action === 'getStatus') {
        getAutomationStatus(sendResponse);
        return true; // Keep message channel open for async response
    } else if (message.action === 'exportLogs') {
        exportLogs(message.format, sendResponse);
        return true;
    }
});

async function startAutomation(comment, urls, minDelay = 2, maxDelay = 5, urlTimeout = 30, retryLimit = 2, dryRun = false, enableLike = true, enableComment = true) {
    const state = await getStoredState();
    if (state.isRunning) {
        return;
    }

    const newState = {
        isRunning: true,
        comment: comment,
        urls: urls,
        currentIndex: 0,
        tabId: null,
        startTime: Date.now(),
        minDelay: minDelay,
        maxDelay: maxDelay,
        urlTimeout: urlTimeout,
        maxRetries: retryLimit,
        dryRun: dryRun,
        enableLike: enableLike,
        enableComment: enableComment,
        isPaused: false,
        activityLog: [],
        urlStatuses: new Array(urls.length).fill().map(() => ({ 
            status: 'pending', 
            attempts: 0, 
            liked: false, 
            commented: false, 
            skipped: false,
            error: null,
            startTime: null,
            endTime: null
        })),
        statistics: {
            total: urls.length,
            processed: 0,
            liked: 0,
            commented: 0,
            skipped: 0,
            failed: 0
        },
        currentTimeout: null
    };

    await saveState(newState);
    await logStructuredMessage(`Starting automation with ${urls.length} URLs${dryRun ? ' (DRY-RUN)' : ''}`, 'success', {
        totalUrls: urls.length,
        delay: `${minDelay}-${maxDelay}s`,
        timeout: `${urlTimeout}s`,
        maxRetries: retryLimit,
        dryRun: dryRun
    });
    
    try {
        await processNextUrl();
    } catch (error) {
        console.error('Automation error:', error);
        const errorCode = ERROR_CODES.UNKNOWN_ERROR;
        await notifyError(`${errorCode}: ${error.message}`);
        await logStructuredMessage('Automation startup failed', 'error', {
            errorCode: errorCode,
            message: error.message
        });
        await stopAutomation();
    }
}

async function processNextUrl() {
    const state = await getStoredState();
    
    if (!state.isRunning) {
        return;
    }
    
    // Handle pause state - don't process but don't stop either
    if (state.isPaused) {
        console.log('Automation is paused, waiting for resume...');
        return;
    }
    
    // Check if all URLs are processed
    if (state.currentIndex >= state.urls.length) {
        // All URLs processed - generate summary
        const summary = generateSummary(state);
        await logStructuredMessage('Automation completed', 'success', summary);
        await notifyProgress(`Completed: ${summary.processed}/${summary.total} URLs`);
        await notifyPopup({action: 'automationComplete', summary: summary});
        await stopAutomation();
        return;
    }

    const currentUrl = state.urls[state.currentIndex];
    const urlStatus = state.urlStatuses[state.currentIndex];
    
    // Start tracking this URL
    urlStatus.startTime = Date.now();
    urlStatus.status = 'processing';
    await saveState(state);
    
    await logStructuredMessage(`Opened: ${currentUrl}`, 'info', {
        url: currentUrl,
        index: state.currentIndex + 1,
        total: state.urls.length,
        attempt: urlStatus.attempts + 1
    });
    
    await notifyProgress(`Processing ${state.currentIndex + 1}/${state.urls.length}: opening post...`);
    await notifyPopup({
        action: 'updateProgress',
        index: state.currentIndex,
        status: `opening post... (attempt ${urlStatus.attempts + 1})`
    });

    // Create or update tab with the LinkedIn post
    try {
        let tabId = state.tabId;
        
        if (tabId) {
            try {
                await chrome.tabs.update(tabId, {url: currentUrl, active: true});
            } catch (error) {
                // Tab might have been closed, create a new one
                const tab = await chrome.tabs.create({url: currentUrl, active: true});
                tabId = tab.id;
                await saveState({...state, tabId: tabId});
            }
        } else {
            const tab = await chrome.tabs.create({url: currentUrl, active: true});
            tabId = tab.id;
            await saveState({...state, tabId: tabId});
        }

        // Set up watchdog timer only for timeouts >= 1 minute
        const urlTimeoutSeconds = state.urlTimeout || 30;
        if (urlTimeoutSeconds >= 60) {
            const timeoutMinutes = Math.ceil(urlTimeoutSeconds / 60);
            chrome.alarms.clear('urlTimeout');
            chrome.alarms.create('urlTimeout', {delayInMinutes: timeoutMinutes});
        }
        
        // Processing will be triggered by tab loading event instead of alarm
        
    } catch (error) {
        console.error('Error creating tab:', error);
        const errorCode = ERROR_CODES.TAB_CLOSED;
        await handleUrlError(currentUrl, errorCode, error.message, state);
    }
}

async function handlePostProcessed(message) {
    const state = await getStoredState();
    if (!state.isRunning) return;
    
    // Clear the timeout since processing completed
    chrome.alarms.clear('urlTimeout');
    
    const urlStatus = state.urlStatuses[state.currentIndex];
    const currentUrl = state.urls[state.currentIndex];
    
    urlStatus.endTime = Date.now();
    const processingTime = (urlStatus.endTime - urlStatus.startTime) / 1000;
    
    if (message.error) {
        // Handle error case
        await handleUrlError(currentUrl, message.errorCode || ERROR_CODES.CONTENT_SCRIPT_ERROR, message.error, state);
        return;
    }
    
    // Process successful result
    urlStatus.status = 'completed';
    urlStatus.liked = message.liked || false;
    urlStatus.commented = message.commented || false;
    urlStatus.skipped = message.skipped || false;
    
    // Update statistics
    state.statistics.processed++;
    if (message.liked) state.statistics.liked++;
    if (message.commented) state.statistics.commented++;
    if (message.skipped) state.statistics.skipped++;
    
    // Log detailed result
    const logData = {
        url: currentUrl,
        processingTime: `${processingTime.toFixed(1)}s`,
        liked: message.liked,
        commented: message.commented,
        skipped: message.skipped,
        reason: message.reason || null
    };
    
    if (message.skipped) {
        await logStructuredMessage(`Skipped: ${currentUrl}`, 'warning', logData);
    } else {
        const actions = [];
        if (message.liked) actions.push('Liked');
        if (message.commented) actions.push('Commented');
        const actionStr = actions.join(' + ') || 'No actions';
        await logStructuredMessage(`Done: ${currentUrl} | ${actionStr}`, 'success', logData);
    }
    
    await notifyProgress(`Post ${state.currentIndex + 1}: ${message.status}`);
    await notifyPopup({
        action: 'updateProgress',
        index: state.currentIndex,
        status: message.status,
        statistics: state.statistics
    });

    // Move to next URL
    const newIndex = state.currentIndex + 1;
    await saveState({...state, currentIndex: newIndex});
    
    // Use random delay before next post
    const randomDelay = getRandomDelay(state.minDelay || 2, state.maxDelay || 5);
    await logStructuredMessage(`Waiting ${randomDelay}s before next post...`, 'info', {delay: randomDelay});
    
    if (randomDelay >= 60) {
        // Use alarm for delays >= 1 minute
        chrome.alarms.clear('nextPost');
        chrome.alarms.create('nextPost', {delayInMinutes: randomDelay / 60});
    } else {
        // Use setTimeout for sub-minute delays
        setTimeout(async () => {
            const currentState = await getStoredState();
            if (currentState.isRunning && !currentState.isPaused) {
                await processNextUrl();
            }
        }, randomDelay * 1000);
    }
}

async function pauseAutomation() {
    const state = await getStoredState();
    if (!state.isRunning) return;
    
    // Clear all pending alarms
    chrome.alarms.clearAll();
    
    // Set paused state
    await saveState({...state, isPaused: true});
    
    await logStructuredMessage('Automation paused by user', 'warning');
    await notifyPopup({action: 'automationPaused'});
    
    try {
        await chrome.action.setBadgeText({text: '⏸'});
        await chrome.action.setBadgeBackgroundColor({color: '#f59e0b'});
        await chrome.action.setTitle({title: 'LinkedIn Auto Commenter: Paused'});
    } catch (error) {
        console.log('Failed to update badge:', error);
    }
}

async function resumeAutomation() {
    const state = await getStoredState();
    if (!state.isRunning || !state.isPaused) return;
    
    // Resume state
    await saveState({...state, isPaused: false});
    
    await logStructuredMessage('Automation resumed by user', 'info');
    await notifyPopup({action: 'automationResumed'});
    
    // Continue processing from current position
    await processNextUrl();
}

async function stopAutomation() {
    const state = await getStoredState();
    
    // Clear all alarms
    chrome.alarms.clearAll();
    
    if (state.tabId) {
        try {
            await chrome.tabs.remove(state.tabId);
        } catch (error) {
            console.log('Tab already closed');
        }
    }
    
    // Generate final summary if automation was running
    if (state.isRunning && state.statistics) {
        const summary = generateSummary(state);
        await logStructuredMessage('Automation stopped', 'warning', summary);
    }
    
    // Reset automation state but preserve logs
    const preservedLogs = state.activityLog || [];
    await saveState({
        isRunning: false,
        comment: '',
        urls: [],
        currentIndex: 0,
        tabId: null,
        activityLog: preservedLogs
    });
    
    // Reset badge
    try {
        await chrome.action.setBadgeText({text: ''});
        await chrome.action.setTitle({title: 'LinkedIn Auto Commenter'});
    } catch (error) {
        console.log('Failed to reset badge:', error);
    }
}

// Handle alarms for reliable timing and timeouts
chrome.alarms.onAlarm.addListener(async (alarm) => {
    const state = await getStoredState();
    
    if (alarm.name === 'processPost' && state.isRunning && !state.isPaused) {
        try {
            await chrome.tabs.sendMessage(state.tabId, {
                action: 'processPost',
                comment: state.comment,
                index: state.currentIndex,
                urlTimeout: state.urlTimeout || 30,
                dryRun: state.dryRun || false,
                enableLike: state.enableLike !== false,
                enableComment: state.enableComment !== false
            });
        } catch (error) {
            console.error('Error sending message to content script:', error);
            const errorCode = ERROR_CODES.CONTENT_SCRIPT_ERROR;
            await handleUrlError(state.urls[state.currentIndex], errorCode, error.message, state);
        }
    } else if (alarm.name === 'nextPost' && state.isRunning && !state.isPaused) {
        await processNextUrl();
    } else if (alarm.name === 'urlTimeout' && state.isRunning && !state.isPaused) {
        // Handle timeout (only for timeouts >= 1 minute)
        const currentUrl = state.urls[state.currentIndex];
        const errorCode = ERROR_CODES.NETWORK_TIMEOUT;
        await handleUrlError(currentUrl, errorCode, `URL processing timeout after ${state.urlTimeout || 30}s`, state);
    } else if (alarm.name === 'retryUrl' && state.isRunning && !state.isPaused) {
        // Handle retry after backoff delay (for retries >= 1 minute)
        await processNextUrl();
    }
});

// Handle tab loading completion to trigger processing
chrome.tabs.onUpdated.addListener(async function(tabId, changeInfo, tab) {
    if (changeInfo.status === 'complete') {
        const state = await getStoredState();
        
        // Check if this is our automation tab and we're ready to process
        if (state.isRunning && !state.isPaused && tabId === state.tabId && 
            state.urls && state.currentIndex < state.urls.length) {
            
            const currentUrl = state.urls[state.currentIndex];
            
            // Verify this tab is for the current URL we're processing
            if (tab.url && (tab.url === currentUrl || tab.url.includes('linkedin.com'))) {
                console.log('Tab loaded, starting post processing...');
                
                // Give a brief moment for the page to settle, then start processing
                setTimeout(async () => {
                    const currentState = await getStoredState();
                    if (currentState.isRunning && !currentState.isPaused && tabId === currentState.tabId) {
                        try {
                            await chrome.tabs.sendMessage(tabId, {
                                action: 'processPost',
                                comment: currentState.comment,
                                index: currentState.currentIndex,
                                urlTimeout: currentState.urlTimeout || 30,
                                dryRun: currentState.dryRun || false,
                                enableLike: currentState.enableLike !== false,
                                enableComment: currentState.enableComment !== false
                            });
                        } catch (error) {
                            console.error('Error sending message to content script:', error);
                            const errorCode = ERROR_CODES.CONTENT_SCRIPT_ERROR;
                            await handleUrlError(currentState.urls[currentState.currentIndex], errorCode, error.message, currentState);
                        }
                    }
                }, 2000); // 2 second settle time
            }
        }
    }
});

// Handle tab closed
chrome.tabs.onRemoved.addListener(async function(tabId) {
    const state = await getStoredState();
    if (tabId === state.tabId) {
        await saveState({...state, tabId: null});
    }
});

// Storage and notification helper functions
async function getStoredState() {
    const result = await chrome.storage.local.get(['automationState']);
    return result.automationState || {
        isRunning: false,
        comment: '',
        urls: [],
        currentIndex: 0,
        tabId: null
    };
}

async function saveState(state) {
    await chrome.storage.local.set({automationState: state});
}

async function getAutomationStatus(sendResponse) {
    const state = await getStoredState();
    sendResponse(state);
}

async function notifyPopup(message) {
    try {
        await chrome.runtime.sendMessage(message);
    } catch (error) {
        // Popup might be closed, ignore
    }
}

async function notifyProgress(text) {
    // Use badge text for persistent progress indication
    try {
        await chrome.action.setBadgeText({text: '●'});
        await chrome.action.setBadgeBackgroundColor({color: '#0077b5'});
        await chrome.action.setTitle({title: `LinkedIn Auto Commenter: ${text}`});
    } catch (error) {
        console.log('Failed to update badge:', error);
    }
}

async function notifyError(message) {
    try {
        await chrome.action.setBadgeText({text: '!'});
        await chrome.action.setBadgeBackgroundColor({color: '#d93025'});
        await chrome.action.setTitle({title: `LinkedIn Auto Commenter Error: ${message}`});
        await chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icon48.png',
            title: 'LinkedIn Auto Commenter',
            message: message
        });
    } catch (error) {
        console.log('Failed to show error notification:', error);
    }
    
    await notifyPopup({action: 'automationError', error: message});
}

// Enhanced error handling with retry logic
async function handleUrlError(url, errorCode, errorMessage, state) {
    const urlStatus = state.urlStatuses[state.currentIndex];
    urlStatus.attempts++;
    urlStatus.error = {code: errorCode, message: errorMessage};
    urlStatus.endTime = Date.now();
    
    // Clear any pending timeouts
    chrome.alarms.clear('urlTimeout');
    
    // Check if we should retry
    const maxRetries = state.maxRetries || 2;
    if (urlStatus.attempts <= maxRetries) {
        // Retry with exponential backoff
        const backoffDelay = Math.min(5 * Math.pow(2, urlStatus.attempts - 1), 30); // Cap at 30s
        
        await logStructuredMessage(`Error: ${url} | ${errorCode} | ${errorMessage} (attempt ${urlStatus.attempts}/${maxRetries + 1})`, 'error', {
            url: url,
            errorCode: errorCode,
            message: errorMessage,
            attempt: urlStatus.attempts,
            maxRetries: maxRetries + 1,
            nextRetry: `${backoffDelay}s`
        });
        
        // Reset status for retry
        urlStatus.status = 'retrying';
        await saveState(state);
        
        // Schedule retry
        if (backoffDelay >= 60) {
            // Use alarm for delays >= 1 minute
            chrome.alarms.clear('retryUrl');
            chrome.alarms.create('retryUrl', {delayInMinutes: backoffDelay / 60});
        } else {
            // Use setTimeout for sub-minute delays
            setTimeout(async () => {
                const currentState = await getStoredState();
                if (currentState.isRunning && !currentState.isPaused) {
                    await processNextUrl();
                }
            }, backoffDelay * 1000);
        }
        return;
    }
    
    // Max retries reached - mark as failed and continue
    urlStatus.status = 'failed';
    state.statistics.failed++;
    
    await logStructuredMessage(`Failed: ${url} | ${errorCode} | ${errorMessage} (final attempt)`, 'error', {
        url: url,
        errorCode: errorCode,
        message: errorMessage,
        totalAttempts: urlStatus.attempts
    });
    
    await notifyPopup({
        action: 'updateProgress',
        index: state.currentIndex,
        status: `failed: ${errorCode}`,
        statistics: state.statistics
    });
    
    // Move to next URL
    const newIndex = state.currentIndex + 1;
    await saveState({...state, currentIndex: newIndex});
    
    // Continue with next URL after brief delay (3 seconds)
    setTimeout(async () => {
        const currentState = await getStoredState();
        if (currentState.isRunning && !currentState.isPaused) {
            await processNextUrl();
        }
    }, 3000);
}

// Generate completion summary
function generateSummary(state) {
    const stats = state.statistics;
    const completionTime = Date.now() - state.startTime;
    
    return {
        total: stats.total,
        processed: stats.processed,
        liked: stats.liked,
        commented: stats.commented,
        skipped: stats.skipped,
        failed: stats.failed,
        completionTime: Math.round(completionTime / 1000),
        successRate: stats.total > 0 ? Math.round((stats.processed / stats.total) * 100) : 0
    };
}

// Enhanced structured logging
async function logStructuredMessage(message, type = 'info', data = {}) {
    const state = await getStoredState();
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp: timestamp,
        message: message,
        type: type,
        data: data,
        displayTime: new Date().toLocaleTimeString()
    };
    
    // Add to activity log
    const activityLog = state.activityLog || [];
    activityLog.push(logEntry);
    
    // Keep only last 100 log entries for better visibility
    if (activityLog.length > 100) {
        activityLog.shift();
    }
    
    await saveState({...state, activityLog: activityLog});
    
    // Send to popup if it's open
    await notifyPopup({
        action: 'logMessage',
        message: message,
        type: type,
        data: data,
        timestamp: logEntry.displayTime
    });
}

// Export logs functionality
async function exportLogs(format, sendResponse) {
    const state = await getStoredState();
    const logs = state.activityLog || [];
    
    try {
        let exportData;
        
        if (format === 'csv') {
            const headers = ['Timestamp', 'Type', 'Message', 'Data'];
            const csvRows = [headers.join(',')];
            
            logs.forEach(log => {
                const row = [
                    log.timestamp,
                    log.type,
                    `"${log.message.replace(/"/g, '""')}"`, // Escape quotes
                    `"${JSON.stringify(log.data || {}).replace(/"/g, '""')}"`
                ];
                csvRows.push(row.join(','));
            });
            
            exportData = csvRows.join('\n');
        } else {
            // JSON format
            exportData = JSON.stringify({
                exportTime: new Date().toISOString(),
                statistics: state.statistics || {},
                logs: logs
            }, null, 2);
        }
        
        sendResponse({success: true, data: exportData, format: format});
    } catch (error) {
        sendResponse({success: false, error: error.message});
    }
}

// Helper function to generate random delay between min and max seconds
function getRandomDelay(minDelay, maxDelay) {
    return Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
}

// Helper function to log messages to activity log and popup
async function logMessage(message, type = 'info') {
    const state = await getStoredState();
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = {
        timestamp: timestamp,
        message: message,
        type: type
    };
    
    // Add to activity log
    const activityLog = state.activityLog || [];
    activityLog.push(logEntry);
    
    // Keep only last 50 log entries
    if (activityLog.length > 50) {
        activityLog.shift();
    }
    
    await saveState({...state, activityLog: activityLog});
    
    // Send to popup if it's open
    await notifyPopup({
        action: 'logMessage',
        message: message,
        type: type
    });
}