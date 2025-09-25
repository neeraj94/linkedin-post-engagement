document.addEventListener('DOMContentLoaded', function() {
    const commentText = document.getElementById('commentText');
    const textInput = document.getElementById('textInput');
    const minDelay = document.getElementById('minDelay');
    const maxDelay = document.getElementById('maxDelay');
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const status = document.getElementById('status');
    const progress = document.getElementById('progress');
    const extractedUrls = document.getElementById('extractedUrls');
    const activityLog = document.getElementById('activityLog');
    const logContent = document.getElementById('logContent');

    let isRunning = false;
    let currentUrls = [];
    let currentIndex = 0;

    // Load saved data
    chrome.storage.sync.get(['commentText', 'textInput', 'minDelay', 'maxDelay'], function(data) {
        if (data.commentText) {
            commentText.value = data.commentText;
        }
        if (data.textInput) {
            textInput.value = data.textInput;
            extractLinkedInUrls();
        }
        if (data.minDelay) {
            minDelay.value = data.minDelay;
        }
        if (data.maxDelay) {
            maxDelay.value = data.maxDelay;
        }
    });

    // Save data when changed
    commentText.addEventListener('input', function() {
        chrome.storage.sync.set({commentText: commentText.value});
    });

    textInput.addEventListener('input', function() {
        chrome.storage.sync.set({textInput: textInput.value});
        extractLinkedInUrls();
    });

    minDelay.addEventListener('input', function() {
        chrome.storage.sync.set({minDelay: minDelay.value});
    });

    maxDelay.addEventListener('input', function() {
        chrome.storage.sync.set({maxDelay: maxDelay.value});
    });

    // URL extraction function
    function extractLinkedInUrls() {
        const text = textInput.value;
        // Updated regex to include lnkd.in and various LinkedIn URL patterns
        const urlRegex = /https?:\/\/(?:(?:www\.)?linkedin\.com\/(?:posts|feed\/update|in)\/[^\s\]]+|lnkd\.in\/[^\s\]]+)/gi;
        const urls = text.match(urlRegex) || [];
        
        // Clean up URLs - remove any trailing characters that shouldn't be there
        const cleanUrls = urls.map(url => {
            // Remove trailing punctuation and whitespace
            return url.replace(/[,.\])\s]*$/, '').trim();
        });

        const uniqueUrls = [...new Set(cleanUrls)];
        currentUrls = uniqueUrls;
        
        if (uniqueUrls.length > 0) {
            extractedUrls.innerHTML = `Found ${uniqueUrls.length} LinkedIn URLs:<br>${uniqueUrls.map(url => `• ${url.length > 60 ? url.substring(0, 60) + '...' : url}`).join('<br>')}`;
        } else {
            extractedUrls.innerHTML = 'No LinkedIn URLs found in the text.';
        }
    }

    startBtn.addEventListener('click', function() {
        const comment = commentText.value.trim();
        const minDelayVal = parseInt(minDelay.value) || 2;
        const maxDelayVal = parseInt(maxDelay.value) || 5;

        if (!comment) {
            updateStatus('Please enter a comment text', 'error');
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

        currentIndex = 0;
        isRunning = true;

        startBtn.style.display = 'none';
        stopBtn.style.display = 'block';
        activityLog.style.display = 'block';
        
        updateStatus('Starting automation...', 'running');
        updateProgress(`Processing ${currentUrls.length} LinkedIn URLs`);
        
        addLogEntry(`Started automation with ${currentUrls.length} URLs`, 'success');
        addLogEntry(`Using delay range: ${minDelayVal}-${maxDelayVal} seconds`, 'info');

        // Send message to background script to start automation
        chrome.runtime.sendMessage({
            action: 'startAutomation',
            comment: comment,
            urls: currentUrls,
            minDelay: minDelayVal,
            maxDelay: maxDelayVal
        });
    });

    stopBtn.addEventListener('click', function() {
        isRunning = false;
        chrome.runtime.sendMessage({action: 'stopAutomation'});
        resetUI();
        updateStatus('Automation stopped', 'idle');
        updateProgress('');
    });

    // Check automation status on popup open
    chrome.runtime.sendMessage({action: 'getStatus'}, function(state) {
        if (state && state.isRunning) {
            currentUrls = state.urls;
            currentIndex = state.currentIndex;
            isRunning = true;
            startBtn.style.display = 'none';
            stopBtn.style.display = 'block';
            updateStatus(`Running: ${currentIndex + 1}/${currentUrls.length} posts`, 'running');
            updateProgress(`Currently processing LinkedIn posts...`);
        }
    });

    // Listen for messages from background script
    chrome.runtime.onMessage.addListener(function(message) {
        if (message.action === 'updateProgress') {
            currentIndex = message.index;
            updateProgress(`Processing ${currentIndex + 1}/${currentUrls.length}: ${message.status}`);
            addLogEntry(`Post ${currentIndex + 1}: ${message.status}`, message.status.includes('error') ? 'error' : 'info');
            if (message.status.includes('completed') || message.status.includes('skipped')) {
                updateStatus(`Processed ${currentIndex + 1}/${currentUrls.length} posts`, 'running');
            }
        } else if (message.action === 'automationComplete') {
            resetUI();
            updateStatus('Automation completed successfully!', 'idle');
            updateProgress(`Completed all ${currentUrls.length} posts`);
            addLogEntry('Automation completed successfully!', 'success');
        } else if (message.action === 'automationError') {
            resetUI();
            updateStatus(`Error: ${message.error}`, 'error');
            updateProgress('');
            addLogEntry(`Error: ${message.error}`, 'error');
        } else if (message.action === 'logMessage') {
            addLogEntry(message.message, message.type || 'info');
        }
    });

    function addLogEntry(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry log-${type}`;
        logEntry.textContent = `[${timestamp}] ${message}`;
        logContent.appendChild(logEntry);
        logContent.scrollTop = logContent.scrollHeight;
    }

    function updateStatus(text, type) {
        status.textContent = text;
        status.className = `status ${type}`;
    }

    function updateProgress(text) {
        progress.textContent = text;
    }

    function resetUI() {
        isRunning = false;
        startBtn.style.display = 'block';
        stopBtn.style.display = 'none';
    }
});