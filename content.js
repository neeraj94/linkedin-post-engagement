// Content script for LinkedIn post automation
let isProcessing = false;

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.action === 'processPost') {
        processLinkedInPost(message.comment, message.index);
    }
});

async function processLinkedInPost(commentText, index) {
    if (isProcessing) {
        return;
    }
    
    isProcessing = true;
    
    try {
        // Wait for page to fully load
        await waitForElement('[data-test-id="feed-shared-update-v2"]', 10000);
        
        let status = '';
        
        // Try to like the post
        const likeResult = await tryLikePost();
        status += likeResult;
        
        // Try to comment on the post
        const commentResult = await tryCommentPost(commentText);
        status += commentResult;
        
        // Send result back to background script
        chrome.runtime.sendMessage({
            action: 'postProcessed',
            status: status || 'completed'
        });
        
    } catch (error) {
        console.error('Error processing post:', error);
        chrome.runtime.sendMessage({
            action: 'postProcessed',
            status: 'error: ' + error.message
        });
    } finally {
        isProcessing = false;
    }
}

async function tryLikePost() {
    try {
        // Look for like button - LinkedIn uses different selectors
        const likeSelectors = [
            '[aria-label*="like"]',
            '[aria-label*="Like"]',
            '[data-control-name="like"]',
            'button[aria-pressed="false"][aria-label*="like"]',
            'button[aria-pressed="false"][aria-label*="Like"]'
        ];
        
        let likeButton = null;
        for (const selector of likeSelectors) {
            const buttons = document.querySelectorAll(selector);
            for (const button of buttons) {
                if (button.getAttribute('aria-pressed') === 'false' || 
                    !button.getAttribute('aria-pressed')) {
                    likeButton = button;
                    break;
                }
            }
            if (likeButton) break;
        }
        
        if (likeButton) {
            // Check if already liked
            if (likeButton.getAttribute('aria-pressed') === 'true') {
                return 'already liked, ';
            }
            
            likeButton.click();
            await sleep(1000); // Wait for like to register
            return 'liked, ';
        } else {
            return 'like button not found, ';
        }
    } catch (error) {
        console.error('Error liking post:', error);
        return 'like failed, ';
    }
}

async function tryCommentPost(commentText) {
    try {
        // Look for comment button
        const commentSelectors = [
            '[aria-label*="comment"]',
            '[aria-label*="Comment"]',
            '[data-control-name="comment"]'
        ];
        
        let commentButton = null;
        for (const selector of commentSelectors) {
            commentButton = document.querySelector(selector);
            if (commentButton) break;
        }
        
        if (commentButton) {
            commentButton.click();
            await sleep(1500); // Wait for comment box to appear
            
            // Look for comment input
            const commentInputSelectors = [
                '[contenteditable="true"][aria-label*="comment"]',
                '[contenteditable="true"][aria-label*="Comment"]',
                '.ql-editor[contenteditable="true"]',
                '[role="textbox"][contenteditable="true"]'
            ];
            
            let commentInput = null;
            for (const selector of commentInputSelectors) {
                commentInput = document.querySelector(selector);
                if (commentInput) break;
            }
            
            if (commentInput) {
                // Check if we already commented by looking for our comment text
                const existingComments = document.querySelectorAll('[data-test-id="comment"]');
                for (const comment of existingComments) {
                    if (comment.textContent.includes(commentText.substring(0, 50))) {
                        return 'already commented';
                    }
                }
                
                // Focus and add the comment
                commentInput.focus();
                commentInput.innerHTML = commentText;
                
                // Trigger input event
                const inputEvent = new Event('input', { bubbles: true });
                commentInput.dispatchEvent(inputEvent);
                
                await sleep(1000);
                
                // Look for submit button
                const submitSelectors = [
                    'button[aria-label*="Post comment"]',
                    'button[data-control-name="comment.post"]',
                    'button[type="submit"]'
                ];
                
                let submitButton = null;
                for (const selector of submitSelectors) {
                    const buttons = document.querySelectorAll(selector);
                    for (const button of buttons) {
                        if (button.textContent.toLowerCase().includes('post') || 
                            button.getAttribute('aria-label')?.toLowerCase().includes('post')) {
                            submitButton = button;
                            break;
                        }
                    }
                    if (submitButton) break;
                }
                
                if (submitButton && !submitButton.disabled) {
                    submitButton.click();
                    await sleep(2000); // Wait for comment to post
                    return 'commented';
                } else {
                    return 'submit button not found or disabled';
                }
            } else {
                return 'comment input not found';
            }
        } else {
            return 'comment button not found';
        }
    } catch (error) {
        console.error('Error commenting on post:', error);
        return 'comment failed: ' + error.message;
    }
}

function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const element = document.querySelector(selector);
        if (element) {
            resolve(element);
            return;
        }
        
        const observer = new MutationObserver((mutations) => {
            const element = document.querySelector(selector);
            if (element) {
                observer.disconnect();
                resolve(element);
            }
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        setTimeout(() => {
            observer.disconnect();
            reject(new Error(`Element ${selector} not found within ${timeout}ms`));
        }, timeout);
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Log when content script loads
console.log('LinkedIn Auto Commenter content script loaded');