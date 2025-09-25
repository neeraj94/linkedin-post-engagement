document.addEventListener('DOMContentLoaded', function() {
    const commentText = document.getElementById('commentText');
    const urlList = document.getElementById('urlList');
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const status = document.getElementById('status');
    const progress = document.getElementById('progress');

    let isRunning = false;
    let currentUrls = [];
    let currentIndex = 0;

    // Load saved data
    chrome.storage.sync.get(['commentText', 'urlList'], function(data) {
        if (data.commentText) {
            commentText.value = data.commentText;
        }
        if (data.urlList) {
            urlList.value = data.urlList;
        }
    });

    // Save data when changed
    commentText.addEventListener('input', function() {
        chrome.storage.sync.set({commentText: commentText.value});
    });

    urlList.addEventListener('input', function() {
        chrome.storage.sync.set({urlList: urlList.value});
    });

    startBtn.addEventListener('click', function() {
        const comment = commentText.value.trim();
        const urls = urlList.value.trim().split('\n').filter(url => url.trim());

        if (!comment) {
            updateStatus('Please enter a comment text', 'error');
            return;
        }

        if (urls.length === 0) {
            updateStatus('Please enter at least one LinkedIn URL', 'error');
            return;
        }

        // Validate URLs
        const linkedinUrls = urls.filter(url => url.includes('linkedin.com'));
        if (linkedinUrls.length === 0) {
            updateStatus('Please enter valid LinkedIn post URLs', 'error');
            return;
        }

        currentUrls = linkedinUrls;
        currentIndex = 0;
        isRunning = true;

        startBtn.style.display = 'none';
        stopBtn.style.display = 'block';
        
        updateStatus('Starting automation...', 'running');
        updateProgress(`Processing ${currentUrls.length} URLs`);

        // Send message to background script to start automation
        chrome.runtime.sendMessage({
            action: 'startAutomation',
            comment: comment,
            urls: currentUrls
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
            if (message.status.includes('completed') || message.status.includes('skipped')) {
                updateStatus(`Processed ${currentIndex + 1}/${currentUrls.length} posts`, 'running');
            }
        } else if (message.action === 'automationComplete') {
            resetUI();
            updateStatus('Automation completed successfully!', 'idle');
            updateProgress(`Completed all ${currentUrls.length} posts`);
        } else if (message.action === 'automationError') {
            resetUI();
            updateStatus(`Error: ${message.error}`, 'error');
            updateProgress('');
        }
    });

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