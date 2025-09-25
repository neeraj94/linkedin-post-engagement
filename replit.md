# LinkedIn Auto Commenter Chrome Extension

## Overview

This project is a Chrome browser extension that automates interactions with LinkedIn posts. The extension allows users to automatically like and comment on multiple LinkedIn posts by providing a list of post URLs and a comment template. It features a user-friendly popup interface for configuration, background processing for automation management, and content script injection for DOM manipulation on LinkedIn pages. The project includes a simple Python HTTP server for distributing the extension files during development and testing.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
The extension uses Chrome's Manifest V3 architecture with a popup-based user interface. The popup (popup.html/popup.js) provides a clean form interface where users can input their comment text and LinkedIn post URLs. The interface includes real-time status updates, progress tracking, and persistent storage of user inputs using Chrome's sync storage API.

### Extension Architecture
The system follows Chrome extension best practices with clear separation of concerns:

- **Background Service Worker** (background.js): Manages the automation workflow, maintains state across browser sessions, and coordinates between different extension components. Uses Chrome's storage API for persistence and handles tab management for sequential post processing.

- **Content Scripts** (content.js): Injected into LinkedIn pages to perform DOM manipulation. Handles the actual liking and commenting actions by finding and interacting with LinkedIn's UI elements. Implements robust element waiting and error handling for reliable automation.

- **Popup Interface** (popup.js): Provides user controls and real-time feedback. Manages user input validation, displays automation progress, and communicates with the background worker.

### Automation Flow
The extension implements a sequential processing pattern where posts are opened one at a time in controlled tabs. This approach ensures reliable execution and reduces the risk of being flagged by LinkedIn's anti-automation systems. The workflow includes validation of already-liked/commented posts to avoid duplicate actions.

### State Management
Uses Chrome's storage API for state persistence, ensuring the automation can resume after browser restarts or extension updates. The state includes current automation status, progress tracking, and user preferences.

## External Dependencies

### Chrome APIs
- **chrome.storage**: For persistent data storage and user preferences
- **chrome.tabs**: For tab management and URL navigation during automation
- **chrome.runtime**: For inter-component messaging and extension lifecycle management
- **chrome.alarms**: For timing and scheduling automation tasks
- **chrome.notifications**: For user notifications and status updates

### Target Platform
- **LinkedIn.com**: The extension specifically targets LinkedIn's web interface and relies on LinkedIn's DOM structure for post interaction. The content scripts are designed to work with LinkedIn's current UI patterns for like buttons, comment sections, and post identification.

### Development Server
- **Python HTTP Server**: A simple development server (server.py) that serves extension files with proper CORS headers for testing and distribution during development phases.

### Browser Compatibility
Designed for Chrome browsers supporting Manifest V3, with permissions configured for LinkedIn domain access and necessary browser APIs for automation functionality.