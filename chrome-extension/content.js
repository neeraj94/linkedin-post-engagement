// Content script for LinkedIn post automation
let isProcessing = false;

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.action === 'processPost') {
        console.log('Content script received processPost message:', message);
        processLinkedInPost(message.comment, message.index);
    }
});

async function processLinkedInPost(commentText, index) {
    if (isProcessing) {
        console.log('Already processing, skipping...');
        return;
    }
    
    isProcessing = true;
    console.log('Starting to process LinkedIn post...');
    
    try {
        // Wait for page to load - try multiple selectors for different LinkedIn page types
        console.log('Waiting for page to load...');
        await waitForLinkedInPage();
        
        let status = '';
        
        // Try to like the post
        console.log('Attempting to like post...');
        const likeResult = await tryLikePost();
        status += likeResult;
        console.log('Like result:', likeResult);
        
        // Try to comment on the post
        console.log('Attempting to comment on post...');
        const commentResult = await tryCommentPost(commentText);
        status += commentResult;
        console.log('Comment result:', commentResult);
        
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

async function waitForLinkedInPage() {
    // Try multiple selectors for different LinkedIn page types
    const pageSelectors = [
        '[data-test-id="feed-shared-update-v2"]', // Feed posts
        '.feed-shared-update-v2',                 // Alternative feed posts
        '.share-update-v2',                       // Individual posts
        '.single-post-view',                      // Single post page
        '[data-urn*="activity:"]',                // Activity containers
        '.activity-content',                      // Activity content
        '.social-action-bar',                     // Action bar with like/comment buttons
        'main[role="main"]'                       // Main content area
    ];
    
    console.log('Trying to find LinkedIn page elements...');
    
    for (const selector of pageSelectors) {
        try {
            console.log('Trying selector:', selector);
            await waitForElement(selector, 2000);
            console.log('Found element with selector:', selector);
            return;
        } catch (e) {
            console.log('Selector not found:', selector);
        }
    }
    
    // If no specific selectors work, just wait a bit for page to settle
    console.log('No specific LinkedIn elements found, waiting for page to settle...');
    await sleep(3000);
}

async function tryLikePost() {
    try {
        // Comprehensive like button selectors for current LinkedIn
        const likeSelectors = [
            // General like button patterns
            'button[aria-label*="Like"]',
            'button[aria-label*="like"]', 
            'button[aria-label*="React Like"]',
            '[data-control-name="like"]',
            
            // Specific LinkedIn patterns
            '.reactions-menu button[aria-label*="Like"]',
            '.social-actions-bar button[aria-label*="Like"]',
            '.social-action-bar button[aria-label*="Like"]',
            'button[data-test-id="like-button"]',
            'button.artdeco-button[aria-label*="Like"]',
            
            // SVG-based like buttons
            'button[aria-label*="Like"] svg',
            'button:has(svg[data-test-id="thumbs-up-outline-medium"])',
            'button:has(svg[data-test-id="thumbs-up-filled-medium"])',
            
            // Fallback patterns
            'button[title*="Like"]',
            'button[title*="like"]',
            '.like-button',
            '[data-tracking-control-name*="like"]'
        ];
        
        console.log('Searching for like button...');
        let likeButton = null;
        
        for (const selector of likeSelectors) {
            try {
                console.log('Trying like selector:', selector);
                const buttons = document.querySelectorAll(selector);
                console.log(`Found ${buttons.length} elements for selector:`, selector);
                
                for (const button of buttons) {
                    const ariaPressed = button.getAttribute('aria-pressed');
                    const ariaLabel = button.getAttribute('aria-label');
                    
                    console.log('Button details:', {
                        selector,
                        ariaLabel,
                        ariaPressed,
                        textContent: button.textContent.trim(),
                        className: button.className
                    });
                    
                    // Check if this is a like button - look for both pressed and unpressed states
                    if (ariaLabel && ariaLabel.toLowerCase().includes('like')) {
                        // Check if already liked
                        if (ariaPressed === 'true' || ariaLabel.toLowerCase().includes('unlike') || 
                            button.classList.contains('active') || button.classList.contains('selected')) {
                            console.log('Post already liked - skipping');
                            return 'already liked, ';
                        }
                        likeButton = button;
                        console.log('Found like button:', button);
                        break;
                    }
                }
                if (likeButton) break;
            } catch (e) {
                console.log('Error with selector:', selector, e);
            }
        }
        
        if (likeButton) {
            // Double check if already liked - this check was already done above
            // Just proceed with clicking
            
            console.log('Clicking like button...');
            likeButton.click();
            await sleep(1500); // Wait for like to register
            console.log('Like button clicked successfully');
            return 'liked, ';
        } else {
            console.log('Like button not found. Available buttons:');
            const allButtons = document.querySelectorAll('button');
            for (let i = 0; i < Math.min(allButtons.length, 10); i++) {
                const btn = allButtons[i];
                console.log(`Button ${i}:`, {
                    ariaLabel: btn.getAttribute('aria-label'),
                    textContent: btn.textContent.trim(),
                    className: btn.className
                });
            }
            return 'like button not found, ';
        }
    } catch (error) {
        console.error('Error liking post:', error);
        return 'like failed: ' + error.message + ', ';
    }
}

async function tryCommentPost(commentText) {
    try {
        // Comprehensive comment button selectors for current LinkedIn
        const commentSelectors = [
            // Primary comment button patterns
            'button[aria-label*="Comment"]',
            'button[aria-label*="comment"]',
            'button[aria-label*="Add a comment"]',
            '[data-control-name="comment"]',
            
            // Specific LinkedIn patterns
            '.social-actions-bar button[aria-label*="Comment"]',
            '.social-action-bar button[aria-label*="Comment"]',
            'button[data-test-id="comment-button"]',
            'button.artdeco-button[aria-label*="Comment"]',
            
            // SVG-based comment buttons
            'button:has(svg[data-test-id="comment-outline-medium"])',
            'button:has(svg[data-test-id="comment-filled-medium"])',
            
            // Fallback patterns
            'button[title*="Comment"]',
            '.comment-button',
            '[data-tracking-control-name*="comment"]'
        ];
        
        console.log('Searching for comment button...');
        let commentButton = null;
        
        for (const selector of commentSelectors) {
            try {
                console.log('Trying comment selector:', selector);
                const buttons = document.querySelectorAll(selector);
                console.log(`Found ${buttons.length} elements for selector:`, selector);
                
                for (const button of buttons) {
                    const ariaLabel = button.getAttribute('aria-label');
                    console.log('Comment button details:', {
                        selector,
                        ariaLabel,
                        textContent: button.textContent.trim(),
                        className: button.className
                    });
                    
                    if (ariaLabel && ariaLabel.toLowerCase().includes('comment')) {
                        commentButton = button;
                        console.log('Found comment button:', button);
                        break;
                    }
                }
                if (commentButton) break;
            } catch (e) {
                console.log('Error with comment selector:', selector, e);
            }
        }
        
        if (!commentButton) {
            console.log('Comment button not found. Available buttons:');
            const allButtons = document.querySelectorAll('button');
            for (let i = 0; i < Math.min(allButtons.length, 15); i++) {
                const btn = allButtons[i];
                console.log(`Button ${i}:`, {
                    ariaLabel: btn.getAttribute('aria-label'),
                    textContent: btn.textContent.trim(),
                    className: btn.className
                });
            }
            return 'comment button not found';
        }
        
        console.log('Clicking comment button...');
        commentButton.click();
        await sleep(2000); // Wait for comment box to appear
        
        // Look for comment input with comprehensive selectors
        const commentInputSelectors = [
            // Primary comment input patterns
            '[contenteditable="true"][aria-label*="comment"]',
            '[contenteditable="true"][aria-label*="Comment"]',
            '[contenteditable="true"][aria-label*="Add a comment"]',
            '[contenteditable="true"][aria-label*="Write a comment"]',
            '[contenteditable="true"][aria-label*="Share your thoughts"]',
            '[contenteditable="true"][placeholder*="comment"]',
            '[contenteditable="true"][placeholder*="Add a comment"]',
            '[contenteditable="true"][placeholder*="Write a comment"]',
            
            // Modern LinkedIn specific patterns
            '.comments-comment-box__form [contenteditable="true"]',
            '.comments-comment-box-comment__form [contenteditable="true"]',
            '.comment-form__text-editor [contenteditable="true"]',
            '.comment-box__form [contenteditable="true"]',
            '.ql-editor[contenteditable="true"]', // Quill editor
            '[role="textbox"][contenteditable="true"]',
            '.comments-comment-texteditor [contenteditable="true"]',
            '.comment-compose-form [contenteditable="true"]',
            
            // Data attribute patterns
            '[data-test-id*="comment"][contenteditable="true"]',
            '[data-control-name*="comment"][contenteditable="true"]',
            '[data-placeholder*="comment"][contenteditable="true"]',
            
            // Fallback patterns
            'div[contenteditable="true"]',
            'textarea[aria-label*="comment"]',
            'textarea[placeholder*="comment"]'
        ];
        
        console.log('Searching for comment input...');
        let commentInput = null;
        
        for (const selector of commentInputSelectors) {
            try {
                console.log('Trying comment input selector:', selector);
                const inputs = document.querySelectorAll(selector);
                console.log(`Found ${inputs.length} comment inputs for selector:`, selector);
                
                for (const input of inputs) {
                    if (input.offsetHeight > 0 && input.offsetWidth > 0) { // Check if visible
                        commentInput = input;
                        console.log('Found visible comment input:', input);
                        break;
                    }
                }
                if (commentInput) break;
            } catch (e) {
                console.log('Error with comment input selector:', selector, e);
            }
        }
        
        if (!commentInput) {
            console.log('Comment input not found. Available contenteditable elements:');
            const editables = document.querySelectorAll('[contenteditable="true"]');
            for (let i = 0; i < Math.min(editables.length, 10); i++) {
                const elem = editables[i];
                console.log(`Editable ${i}:`, {
                    ariaLabel: elem.getAttribute('aria-label'),
                    placeholder: elem.getAttribute('placeholder'),
                    className: elem.className,
                    visible: elem.offsetHeight > 0 && elem.offsetWidth > 0
                });
            }
            return 'comment input not found';
        }
        
        // Check if we already commented - look more comprehensively
        console.log('Checking for existing comments...');
        const existingCommentSelectors = [
            '[data-test-id="comment"]',
            '.comment-item', 
            '.comments-comment-item',
            '.comment-entity',
            '.social-comment-entity',
            '.feed-shared-comment',
            '.comments-comment-v2'
        ];
        
        const shortCommentText = commentText.substring(0, 30).toLowerCase().trim();
        let foundExistingComment = false;
        
        for (const selector of existingCommentSelectors) {
            const comments = document.querySelectorAll(selector);
            console.log(`Checking ${comments.length} existing comments with selector: ${selector}`);
            
            for (const comment of comments) {
                const commentContent = comment.textContent.toLowerCase().trim();
                if (commentContent.includes(shortCommentText)) {
                    console.log('Found existing comment with matching text:', commentContent.substring(0, 100));
                    foundExistingComment = true;
                    break;
                }
            }
            if (foundExistingComment) break;
        }
        
        if (foundExistingComment) {
            console.log('Already commented with this text - skipping');
            return 'already commented';
        }
        
        // Focus and add the comment
        console.log('Adding comment text...');
        commentInput.focus();
        
        // Clear existing content and add new comment
        commentInput.innerHTML = '';
        commentInput.textContent = '';
        
        // Use more robust text insertion methods for LinkedIn's rich editors
        if (commentInput.contentEditable === 'true') {
            // For contenteditable elements, use document.execCommand or modern methods
            commentInput.focus();
            
            // Clear and insert text
            commentInput.innerHTML = '';
            const textNode = document.createTextNode(commentText);
            commentInput.appendChild(textNode);
            
            // Trigger comprehensive events for rich text editors
            const events = [
                new Event('focus', { bubbles: true }),
                new Event('beforeinput', { bubbles: true, cancelable: true }),
                new Event('keydown', { bubbles: true, cancelable: true }),
                new Event('input', { bubbles: true, cancelable: true }),
                new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: commentText }),
                new Event('keyup', { bubbles: true }),
                new Event('change', { bubbles: true }),
                new Event('blur', { bubbles: true })
            ];
            
            for (const event of events) {
                commentInput.dispatchEvent(event);
            }
        } else {
            // For regular input/textarea elements
            commentInput.value = commentText;
            commentInput.focus();
            
            const events = [
                new Event('focus', { bubbles: true }),
                new Event('input', { bubbles: true }),
                new Event('keyup', { bubbles: true }),
                new Event('change', { bubbles: true }),
                new Event('blur', { bubbles: true })
            ];
            
            for (const event of events) {
                commentInput.dispatchEvent(event);
            }
        }
        
        await sleep(1500);
        
        // Find the comment container to scope our submit button search
        const commentContainer = commentInput.closest('.comments-comment-box, .comment-compose-form, .comment-form, .comments-comment-entity, form') || document;
        
        // Look for submit/post button with comprehensive selectors (scoped to comment container)
        const submitSelectors = [
            // Primary comment submit patterns
            'button[aria-label*="Post comment"]',
            'button[aria-label*="Post your comment"]',
            'button[aria-label*="Submit comment"]',
            'button[aria-label*="Post"]',
            'button[data-control-name="comment.post"]',
            'button[data-control-name*="comment_submit"]',
            'button[data-control-name*="comment"]',
            
            // Form and container-based selectors
            'button[type="submit"]',
            '.comment-compose-form button[type="submit"]',
            '.comments-comment-box button[aria-label*="Post"]',
            '.comments-comment-entity button',
            '.comments-comment-item button',
            
            // Modern LinkedIn UI patterns
            'button.artdeco-button--primary',
            'button.comments-comment-box__submit-button',
            'button.comment-form__submit-button',
            '.comment-form button[aria-label*="Post"]',
            '.comment-box button[aria-label*="Post"]',
            
            // Generic button patterns near comment areas
            'button:has(span:contains("Post"))',
            'button:has([data-control-name*="comment"])',
            '[data-test-id*="comment"] button',
            
            // Backup patterns
            'button[aria-label*="Share"]',
            'button.artdeco-button[aria-label*="comment"]'
        ];
        
        console.log('Searching for submit button...');
        let submitButton = null;
        
        for (const selector of submitSelectors) {
            try {
                console.log('Trying submit selector:', selector);
                const buttons = commentContainer.querySelectorAll(selector);
                
                for (const button of buttons) {
                    const ariaLabel = button.getAttribute('aria-label');
                    const textContent = button.textContent.toLowerCase().trim();
                    const dataControlName = button.getAttribute('data-control-name');
                    
                    // Check multiple criteria for submit buttons
                    const isSubmitButton = (
                        (ariaLabel && (
                            ariaLabel.toLowerCase().includes('post') ||
                            ariaLabel.toLowerCase().includes('submit') ||
                            ariaLabel.toLowerCase().includes('comment')
                        )) ||
                        (textContent && (
                            textContent.includes('post') || 
                            textContent.includes('submit') ||
                            textContent === 'post'
                        )) ||
                        (dataControlName && dataControlName.includes('comment')) ||
                        button.type === 'submit'
                    );
                    
                    // Also check if button is visible and enabled
                    const isVisible = button.offsetParent !== null;
                    const isEnabled = !button.disabled && !button.hasAttribute('disabled') && !button.getAttribute('aria-disabled');
                    const computedStyle = window.getComputedStyle(button);
                    const isStyleVisible = computedStyle.display !== 'none' && computedStyle.visibility !== 'hidden';
                    
                    if (isSubmitButton && isVisible && isEnabled && isStyleVisible) {
                        submitButton = button;
                        console.log('Found submit button:', {
                            ariaLabel,
                            textContent,
                            dataControlName,
                            visible: isVisible,
                            enabled: isEnabled,
                            element: button
                        });
                        break;
                    }
                }
                if (submitButton) break;
            } catch (e) {
                console.log('Error with submit selector:', selector, e);
            }
        }
        
        if (submitButton && !submitButton.disabled && !submitButton.getAttribute('disabled')) {
            console.log('Clicking submit button...');
            submitButton.click();
            await sleep(3000); // Wait for comment to post
            return 'commented';
        } else {
            console.log('Submit button not found or disabled. Available buttons near comment:');
            const nearbyButtons = commentInput.closest('form, .comment-compose-form, .comments-comment-box')?.querySelectorAll('button') || [];
            for (let i = 0; i < nearbyButtons.length; i++) {
                const btn = nearbyButtons[i];
                console.log(`Nearby button ${i}:`, {
                    ariaLabel: btn.getAttribute('aria-label'),
                    textContent: btn.textContent.trim(),
                    disabled: btn.disabled,
                    className: btn.className
                });
            }
            return 'submit button not found or disabled';
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