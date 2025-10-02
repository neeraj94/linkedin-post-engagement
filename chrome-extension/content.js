// Enhanced content script for LinkedIn post automation with strict idempotency
let isProcessing = false;
let processingTimeout = null;

// Enhanced error codes matching background script
const ERROR_CODES = {
    AUTH_401: 'AUTH_401',
    AUTH_EXPIRED: 'AUTH_EXPIRED', 
    RATE_LIMIT: 'RATE_LIMIT',
    NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
    DOM_NOT_FOUND: 'DOM_NOT_FOUND',
    ACTION_VERIFICATION_FAILED: 'ACTION_VERIFICATION_FAILED',
    ALREADY_PROCESSED: 'ALREADY_PROCESSED'
};

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.action === 'processPost') {
        console.log('Content script received processPost message:', message);
        processLinkedInPost(
            message.comment, 
            message.index, 
            message.urlTimeout || 30, 
            message.dryRun || false,
            message.enableLike !== false,
            message.enableComment !== false
        );
    }
});

async function processLinkedInPost(commentText, index, timeout = 30, dryRun = false, enableLike = true, enableComment = true) {
    if (isProcessing) {
        console.log('Already processing, skipping...');
        return;
    }
    
    isProcessing = true;
    console.log(`Starting to process LinkedIn post with ${timeout}s timeout...`);
    console.log(`Action preferences: Like=${enableLike}, Comment=${enableComment}`);
    
    // Set up timeout for this processing
    processingTimeout = setTimeout(() => {
        console.error('Processing timeout reached');
        sendResult({
            error: `Processing timeout after ${timeout}s`,
            errorCode: ERROR_CODES.NETWORK_TIMEOUT,
            skipped: true
        });
        isProcessing = false;
    }, timeout * 1000);
    
    try {
        // Wait for page to load
        console.log('Waiting for page to load...');
        await waitForLinkedInPage();
        
        // Check current like and comment status with strict idempotency
        console.log('Checking current post status for idempotency...');
        const currentStatus = await checkCurrentPostStatus(commentText);
        console.log('Current post status:', currentStatus);
        
        // Implement strict idempotency matrix
        const result = await processAccordingToMatrix(currentStatus, commentText, dryRun, enableLike, enableComment);
        
        sendResult(result);
        
    } catch (error) {
        console.error('Error processing post:', error);
        sendResult({
            error: error.message,
            errorCode: ERROR_CODES.DOM_NOT_FOUND,
            skipped: true
        });
    } finally {
        if (processingTimeout) {
            clearTimeout(processingTimeout);
            processingTimeout = null;
        }
        isProcessing = false;
    }
}

// Helper function to send results back to background script
function sendResult(result) {
    chrome.runtime.sendMessage({
        action: 'postProcessed',
        status: result.status || 'processed',
        liked: result.liked || false,
        commented: result.commented || false,
        skipped: result.skipped || false,
        reason: result.reason || null,
        error: result.error || null,
        errorCode: result.errorCode || null
    });
}

// Check current like and comment status for strict idempotency
async function checkCurrentPostStatus(commentText) {
    const status = {
        isLiked: false,
        hasCommented: false,
        postContainer: null
    };
    
    // Find the post container first
    const postSelectors = [
        '[data-test-id="feed-shared-update-v2"]',
        '.feed-shared-update-v2', 
        '.share-update-v2',
        '.single-post-view',
        '[data-urn*="activity:"]',
        'article[data-urn]'
    ];
    
    for (const selector of postSelectors) {
        const container = document.querySelector(selector);
        if (container) {
            status.postContainer = container;
            console.log('Found post container:', selector);
            break;
        }
    }
    
    if (!status.postContainer) {
        status.postContainer = document;
        console.log('Using document as fallback container');
    }
    
    // Check like status
    status.isLiked = await checkLikeStatus(status.postContainer);
    
    // Check comment status  
    status.hasCommented = await checkCommentStatus(status.postContainer, commentText);
    
    return status;
}

// Enhanced like status detection
async function checkLikeStatus(container) {
    const likeSelectors = [
        'button[aria-label*="Like"][aria-pressed="true"]',
        'button[aria-label*="unlike" i]', // "Unlike" indicates already liked
        'button[aria-label*="Like"].active',
        'button[aria-label*="Like"].selected',
        'button.artdeco-button--primary[aria-label*="Like"]',
        '.social-action-bar button[aria-pressed="true"][aria-label*="Like"]'
    ];
    
    for (const selector of likeSelectors) {
        const likeButton = container.querySelector(selector);
        if (likeButton) {
            const ariaLabel = likeButton.getAttribute('aria-label') || '';
            const ariaPressed = likeButton.getAttribute('aria-pressed');
            
            if (ariaPressed === 'true' || ariaLabel.toLowerCase().includes('unlike')) {
                console.log('Post already liked by current user');
                return true;
            }
        }
    }
    
    return false;
}

// Enhanced comment status detection - checks if current user has already commented
async function checkCommentStatus(container, commentText) {
    const commentSelectors = [
        '.comments-comment-item',
        '.comments-comment-entity',
        '.comment-entity', 
        '.feed-shared-comment',
        '[data-test-id="comment"]',
        '.social-comment-entity'
    ];
    
    // Get current user info to identify their comments
    const currentUserInfo = await getCurrentUserInfo();
    console.log('Current user info:', currentUserInfo);
    
    for (const selector of commentSelectors) {
        const comments = container.querySelectorAll(selector);
        console.log(`Checking ${comments.length} comments with selector: ${selector}`);
        
        for (const comment of comments) {
            // Check if this comment is from the current user
            if (isCommentByCurrentUser(comment, currentUserInfo)) {
                console.log('Found comment by current user - skipping post');
                return true;
            }
        }
    }
    
    return false;
}

// Get current user info from LinkedIn page
async function getCurrentUserInfo() {
    const userInfo = {
        profileUrl: null,
        name: null,
        miniProfileId: null
    };
    
    // Try to find current user's profile link
    const profileSelectors = [
        'a.global-nav__primary-link-me-menu-trigger',
        '.global-nav__me-photo',
        '.global-nav__me img',
        '[data-control-name="identity_profile_photo"]',
        'a[href*="/in/"][href*="miniProfileUrn"]'
    ];
    
    for (const selector of profileSelectors) {
        const element = document.querySelector(selector);
        if (element) {
            const link = element.closest('a');
            if (link) {
                userInfo.profileUrl = link.href;
                // Extract mini profile ID from URL if present
                const miniProfileMatch = link.href.match(/miniProfileUrn=([^&]+)/);
                if (miniProfileMatch) {
                    userInfo.miniProfileId = decodeURIComponent(miniProfileMatch[1]);
                }
                console.log('Found current user profile URL:', userInfo.profileUrl);
                break;
            }
        }
    }
    
    // Try to get user name from navigation
    const nameElement = document.querySelector('.global-nav__me-content .t-16.t-black.t-bold, .global-nav__me-content span');
    if (nameElement) {
        userInfo.name = nameElement.textContent.trim();
        console.log('Found current user name:', userInfo.name);
    }
    
    return userInfo;
}

// Check if a comment was made by the current user
function isCommentByCurrentUser(commentElement, currentUserInfo) {
    // Method 1: Check for "you" indicator in comment
    const youIndicators = commentElement.querySelectorAll('[aria-label*="You"], .comments-post-meta__name-text a[aria-label*="You"]');
    if (youIndicators.length > 0) {
        console.log('Found "You" indicator in comment');
        return true;
    }
    
    // Method 2: Check comment author's profile link
    const authorLinkSelectors = [
        '.comments-post-meta__profile-link',
        '.comments-comment-item__main-content a[href*="/in/"]',
        '.comment-entity a[href*="/in/"]',
        'a.comment-author-link',
        '.comments-post-meta__name-text a'
    ];
    
    for (const selector of authorLinkSelectors) {
        const authorLink = commentElement.querySelector(selector);
        if (authorLink && currentUserInfo.profileUrl) {
            const authorHref = authorLink.href;
            
            // Extract base profile URLs for comparison
            const currentProfileBase = currentUserInfo.profileUrl.split('?')[0].split('/').filter(p => p).pop();
            const authorProfileBase = authorHref.split('?')[0].split('/').filter(p => p).pop();
            
            if (currentProfileBase && authorProfileBase && currentProfileBase === authorProfileBase) {
                console.log('Found comment by current user (profile URL match)');
                return true;
            }
            
            // Check mini profile ID if available
            if (currentUserInfo.miniProfileId) {
                const authorMiniProfileMatch = authorHref.match(/miniProfileUrn=([^&]+)/);
                if (authorMiniProfileMatch) {
                    const authorMiniProfileId = decodeURIComponent(authorMiniProfileMatch[1]);
                    if (authorMiniProfileId === currentUserInfo.miniProfileId) {
                        console.log('Found comment by current user (mini profile ID match)');
                        return true;
                    }
                }
            }
        }
    }
    
    // Method 3: Check author name if available
    if (currentUserInfo.name) {
        const authorNameElement = commentElement.querySelector('.comments-post-meta__name-text, .comment-author-name');
        if (authorNameElement) {
            const authorName = authorNameElement.textContent.trim();
            if (authorName === currentUserInfo.name || authorName.includes(currentUserInfo.name)) {
                console.log('Found comment by current user (name match)');
                return true;
            }
        }
    }
    
    return false;
}

// Extract text content from comment element
function extractCommentText(commentElement) {
    const contentSelectors = [
        '.comment-content',
        '.comments-comment-item-content-text',
        '.feed-shared-text',
        '[data-test-id="comment-content"]',
        '.comment-text'
    ];
    
    for (const selector of contentSelectors) {
        const contentEl = commentElement.querySelector(selector);
        if (contentEl) {
            return contentEl.textContent || contentEl.innerText || '';
        }
    }
    
    // Fallback to full element text
    return commentElement.textContent || commentElement.innerText || '';
}

// Implement strict idempotency matrix with action preferences
async function processAccordingToMatrix(currentStatus, commentText, dryRun = false, enableLike = true, enableComment = true) {
    const result = {
        liked: false,
        commented: false,
        skipped: false,
        status: '',
        reason: ''
    };
    
    console.log('Processing according to matrix:', currentStatus);
    console.log('Action preferences:', { enableLike, enableComment });
    
    // Determine what actions to attempt based on preferences and current status
    const shouldAttemptLike = enableLike && !currentStatus.isLiked;
    const shouldAttemptComment = enableComment && !currentStatus.hasCommented;
    
    // Check if post should be skipped entirely
    if ((!enableLike || currentStatus.isLiked) && (!enableComment || currentStatus.hasCommented)) {
        console.log('Post should be skipped based on preferences and current status');
        result.skipped = true;
        
        if (!enableLike && !enableComment) {
            result.status = 'skipped (no actions enabled)';
            result.reason = 'no_actions_enabled';
        } else if (currentStatus.isLiked && currentStatus.hasCommented) {
            result.status = 'already liked and commented';
            result.reason = 'already_processed';
        } else if (currentStatus.isLiked && !enableComment) {
            result.status = 'already liked (commenting disabled)';
            result.reason = 'already_liked_commenting_disabled';
        } else if (currentStatus.hasCommented && !enableLike) {
            result.status = 'already commented (liking disabled)';
            result.reason = 'already_commented_liking_disabled';
        } else {
            result.status = 'skipped';
            result.reason = 'conditions_not_met';
        }
        
        return result;
    }
    
    if (dryRun) {
        // Dry-run mode: simulate actions without actually performing them
        console.log('DRY-RUN MODE: Simulating actions based on matrix and preferences');
        
        if (shouldAttemptLike && shouldAttemptComment) {
            result.liked = true; 
            result.commented = true;
            result.status = 'would like and comment (simulated)';
        } else if (shouldAttemptLike) {
            result.liked = true;
            result.status = 'would like (simulated)';
        } else if (shouldAttemptComment) {
            result.commented = true;
            result.status = 'would comment (simulated)';
        }
        
    } else {
        // Normal operation mode
        const actions = [];
        
        if (shouldAttemptLike) {
            console.log('Attempting to like post...');
            const likeResult = await performLike(currentStatus.postContainer);
            result.liked = likeResult.success;
            actions.push(likeResult.message);
        }
        
        if (shouldAttemptComment) {
            console.log('Attempting to comment on post...');
            const commentResult = await performComment(currentStatus.postContainer, commentText);
            result.commented = commentResult.success;
            actions.push(commentResult.message);
        }
        
        result.status = actions.join(' ').trim();
        
        // Add reason if some actions were already done
        if (enableLike && currentStatus.isLiked && !enableComment) {
            result.reason = 'already_liked';
        } else if (enableComment && currentStatus.hasCommented && !enableLike) {
            result.reason = 'already_commented';
        } else if (currentStatus.isLiked && !shouldAttemptLike) {
            result.reason = 'already_liked';
        } else if (currentStatus.hasCommented && !shouldAttemptComment) {
            result.reason = 'already_commented';
        }
    }
    
    return result;
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
        
        
        // Add comment text using enhanced method
        console.log('Adding comment text...');
        await addCommentText(commentInput, commentText);
        
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

// Perform like action with enhanced detection and error handling
async function performLike(container) {
    const result = { success: false, message: 'like failed' };
    
    const likeSelectors = [
        'button[aria-label*="Like"][aria-pressed="false"]',
        'button[aria-label*="Like"]:not([aria-pressed="true"])',
        'button[aria-label*="React Like"]',
        '[data-control-name="like"]:not(.active)',
        '.social-actions-bar button[aria-label*="Like"]',
        '.social-action-bar button[aria-label*="Like"]',
        'button.artdeco-button[aria-label*="Like"]:not(.artdeco-button--primary)'
    ];
    
    for (const selector of likeSelectors) {
        try {
            const buttons = container.querySelectorAll(selector);
            
            for (const button of buttons) {
                const ariaLabel = button.getAttribute('aria-label') || '';
                const ariaPressed = button.getAttribute('aria-pressed');
                
                // Make sure this is an unliked like button
                if (ariaLabel.toLowerCase().includes('like') && 
                    ariaPressed !== 'true' && 
                    !ariaLabel.toLowerCase().includes('unlike') &&
                    button.offsetParent !== null) { // Check visibility
                    
                    console.log('Clicking like button:', button);
                    button.click();
                    
                    // Wait and verify like was successful
                    await sleep(2000);
                    
                    // Check if button state changed to indicate successful like
                    const newAriaPressed = button.getAttribute('aria-pressed');
                    const newAriaLabel = button.getAttribute('aria-label') || '';
                    
                    if (newAriaPressed === 'true' || newAriaLabel.toLowerCase().includes('unlike')) {
                        result.success = true;
                        result.message = 'liked';
                        console.log('Like successful - button state changed');
                        return result;
                    }
                }
            }
        } catch (e) {
            console.log('Error with like selector:', selector, e);
        }
    }
    
    result.message = 'like button not found';
    return result;
}

// Perform comment action with enhanced detection and error handling
async function performComment(container, commentText) {
    const result = { success: false, message: 'comment failed' };
    
    try {
        // First, find and click comment button
        const commentButton = await findCommentButton(container);
        if (!commentButton) {
            result.message = 'comment button not found';
            return result;
        }
        
        console.log('Clicking comment button...');
        commentButton.click();
        await sleep(2000);
        
        // Find comment input
        const commentInput = await findCommentInput(container);
        if (!commentInput) {
            result.message = 'comment input not found';
            return result;
        }
        
        // Add comment text
        console.log('Adding comment text...');
        await addCommentText(commentInput, commentText);
        await sleep(1500);
        
        // Find and click submit button
        const submitButton = await findSubmitButton(container, commentInput);
        if (!submitButton) {
            result.message = 'submit button not found';
            return result;
        }
        
        console.log('Clicking submit button...');
        submitButton.click();
        await sleep(3000);
        
        result.success = true;
        result.message = 'commented';
        return result;
        
    } catch (error) {
        console.error('Error in performComment:', error);
        result.message = `comment error: ${error.message}`;
        return result;
    }
}

// Find comment button with enhanced selectors
async function findCommentButton(container) {
    const commentSelectors = [
        'button[aria-label*="Comment"]',
        'button[aria-label*="Add a comment"]',
        'button[data-control-name="comment"]',
        '.social-actions-bar button[aria-label*="Comment"]',
        '.social-action-bar button[aria-label*="Comment"]',
        'button:has(svg[data-test-id="comment-outline-medium"])'
    ];
    
    for (const selector of commentSelectors) {
        try {
            const buttons = container.querySelectorAll(selector);
            for (const button of buttons) {
                const ariaLabel = button.getAttribute('aria-label') || '';
                if (ariaLabel.toLowerCase().includes('comment') && button.offsetParent !== null) {
                    return button;
                }
            }
        } catch (e) {
            console.log('Error with comment button selector:', selector, e);
        }
    }
    
    return null;
}

// Find comment input with enhanced selectors
async function findCommentInput(container) {
    // Wait for input to appear after clicking comment button
    await sleep(1000);
    
    const inputSelectors = [
        '[contenteditable="true"][aria-label*="comment"]',
        '[contenteditable="true"][placeholder*="comment"]',
        '.comments-comment-box__form [contenteditable="true"]',
        '.comment-form__text-editor [contenteditable="true"]',
        '.ql-editor[contenteditable="true"]',
        '[role="textbox"][contenteditable="true"]',
        'div[contenteditable="true"]:not([aria-label*="search"])'
    ];
    
    for (const selector of inputSelectors) {
        try {
            const inputs = container.querySelectorAll(selector);
            for (const input of inputs) {
                if (input.offsetParent !== null) { // Check visibility
                    return input;
                }
            }
        } catch (e) {
            console.log('Error with input selector:', selector, e);
        }
    }
    
    return null;
}

// Find submit button with enhanced selectors
async function findSubmitButton(container, inputElement) {
    const inputContainer = inputElement.closest('.comments-comment-box, .comment-compose-form, .comment-form, form') || container;
    
    const submitSelectors = [
        'button[aria-label*="Post comment"]',
        'button[aria-label*="Post your comment"]', 
        'button[type="submit"]',
        'button.artdeco-button--primary',
        '.comment-form__submit-button',
        'button[data-control-name*="comment"]'
    ];
    
    for (const selector of submitSelectors) {
        try {
            const buttons = inputContainer.querySelectorAll(selector);
            for (const button of buttons) {
                const ariaLabel = button.getAttribute('aria-label') || '';
                const textContent = button.textContent.toLowerCase().trim();
                
                const isSubmitButton = (
                    ariaLabel.toLowerCase().includes('post') ||
                    textContent.includes('post') ||
                    button.type === 'submit'
                );
                
                if (isSubmitButton && button.offsetParent !== null && !button.disabled) {
                    return button;
                }
            }
        } catch (e) {
            console.log('Error with submit selector:', selector, e);
        }
    }
    
    return null;
}

// Enhanced comment text insertion
async function addCommentText(commentInput, commentText) {
    commentInput.focus();
    
    // Clear existing content
    commentInput.innerHTML = '';
    commentInput.textContent = '';
    
    if (commentInput.contentEditable === 'true') {
        // For contenteditable elements
        const textNode = document.createTextNode(commentText);
        commentInput.appendChild(textNode);
        
        // Trigger comprehensive events
        const events = [
            new Event('focus', { bubbles: true }),
            new Event('beforeinput', { bubbles: true, cancelable: true }),
            new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: commentText }),
            new Event('change', { bubbles: true }),
            new Event('keyup', { bubbles: true })
        ];
        
        for (const event of events) {
            commentInput.dispatchEvent(event);
        }
    } else {
        // For regular input elements
        commentInput.value = commentText;
        
        const events = [
            new Event('focus', { bubbles: true }),
            new Event('input', { bubbles: true }),
            new Event('change', { bubbles: true })
        ];
        
        for (const event of events) {
            commentInput.dispatchEvent(event);
        }
    }
    
    // Final cursor positioning
    if (window.getSelection && document.createRange) {
        const range = document.createRange();
        const selection = window.getSelection();
        if (commentInput.childNodes.length > 0) {
            range.setStartAfter(commentInput.childNodes[commentInput.childNodes.length - 1]);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
        }
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

// Helper function to calculate text similarity
function calculateSimilarity(str1, str2) {
    if (str1 === str2) return 1.0;
    if (str1.length === 0 || str2.length === 0) return 0.0;
    
    // Simple similarity based on common words and character overlap
    const words1 = str1.split(/\s+/).filter(w => w.length > 2);
    const words2 = str2.split(/\s+/).filter(w => w.length > 2);
    
    if (words1.length === 0 || words2.length === 0) {
        // Character-based similarity for short texts
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        const editDistance = levenshteinDistance(longer, shorter);
        return (longer.length - editDistance) / longer.length;
    }
    
    const commonWords = words1.filter(w => words2.includes(w));
    const totalWords = Math.max(words1.length, words2.length);
    
    return commonWords.length / totalWords;
}

// Simple Levenshtein distance calculation
function levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    
    return matrix[str2.length][str1.length];
}

// Log when content script loads
console.log('LinkedIn Auto Commenter content script loaded');