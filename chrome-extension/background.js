// Use chrome.storage to persist state across service worker suspensions
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.action === 'startAutomation') {
        startAutomation(message.comment, message.urls, message.minDelay, message.maxDelay);
    } else if (message.action === 'stopAutomation') {
        stopAutomation();
    } else if (message.action === 'postProcessed') {
        handlePostProcessed(message);
    } else if (message.action === 'getStatus') {
        getAutomationStatus(sendResponse);
        return true; // Keep message channel open for async response
    }
});

async function startAutomation(comment, urls, minDelay = 2, maxDelay = 5) {
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
        activityLog: []
    };

    await saveState(newState);
    await logMessage(`Starting automation with ${urls.length} URLs and ${minDelay}-${maxDelay}s delay`, 'success');
    
    try {
        await processNextUrl();
    } catch (error) {
        console.error('Automation error:', error);
        await notifyError('Automation error: ' + error.message);
        await logMessage('Automation error: ' + error.message, 'error');
        await stopAutomation();
    }
}

async function processNextUrl() {
    const state = await getStoredState();
    
    if (!state.isRunning || state.currentIndex >= state.urls.length) {
        // All URLs processed
        await notifyProgress('Automation completed successfully!');
        await notifyPopup({action: 'automationComplete'});
        await stopAutomation();
        return;
    }

    const currentUrl = state.urls[state.currentIndex];
    
    await notifyProgress(`Processing ${state.currentIndex + 1}/${state.urls.length}: opening post...`);
    await notifyPopup({
        action: 'updateProgress',
        index: state.currentIndex,
        status: 'opening post...'
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

        // Use chrome.alarms instead of setTimeout to survive service worker suspension
        chrome.alarms.clear('processPost');
        chrome.alarms.create('processPost', {delayInMinutes: 0.05}); // 3 seconds
        
    } catch (error) {
        console.error('Error creating tab:', error);
        await notifyError('Failed to open LinkedIn post: ' + error.message);
        await stopAutomation();
    }
}

async function handlePostProcessed(message) {
    const state = await getStoredState();
    if (!state.isRunning) return;

    await notifyProgress(`Post ${state.currentIndex + 1}: ${message.status}`);
    await notifyPopup({
        action: 'updateProgress',
        index: state.currentIndex,
        status: message.status
    });

    const newIndex = state.currentIndex + 1;
    await saveState({...state, currentIndex: newIndex});
    
    // Use chrome.alarms for reliable timing with random delay
    const randomDelay = getRandomDelay(state.minDelay || 2, state.maxDelay || 5);
    await logMessage(`Waiting ${randomDelay}s before next post...`, 'info');
    
    chrome.alarms.clear('nextPost');
    chrome.alarms.create('nextPost', {delayInMinutes: randomDelay / 60}); // Convert seconds to minutes
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
    
    // Reset automation state
    await saveState({
        isRunning: false,
        comment: '',
        urls: [],
        currentIndex: 0,
        tabId: null
    });
}

// Handle alarms for reliable timing
chrome.alarms.onAlarm.addListener(async (alarm) => {
    const state = await getStoredState();
    
    if (alarm.name === 'processPost' && state.isRunning) {
        try {
            await chrome.tabs.sendMessage(state.tabId, {
                action: 'processPost',
                comment: state.comment,
                index: state.currentIndex
            });
        } catch (error) {
            console.error('Error sending message to content script:', error);
            await notifyError('Failed to process post: ' + error.message);
            await stopAutomation();
        }
    } else if (alarm.name === 'nextPost' && state.isRunning) {
        await processNextUrl();
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