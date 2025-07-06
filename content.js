// content.js (English-Only Version)
const MESSAGE_ACTIONS = {
    UPDATE_SELECTED_TEXT: 'updateSelectedText',
    GET_SELECTED_TEXT: 'getSelectedText',
    QUERY_SELECTED_TEXT: 'querySelectedText',
    OPEN_LOOKUP_TAB: 'openLookupTab',
    GET_CAMBRIDGE_AUDIO_URL: 'getCambridgeAudioUrl'
};

const ICON_DEFINITIONS = {
    LOOKUP: {
        key: 'LOOKUP',
        id: 'cambridge-lookup-icon',
        fileName: 'lookup_icon.png', // You might want a different icon for Cambridge
        titleTemplate: 'Lookup "{text}" on Cambridge',
        messageAction: MESSAGE_ACTIONS.OPEN_LOOKUP_TAB,
        hideIconsPostAction: true,
        isAudio: false
    }
};

const ICON_SPACING = 5;
const ICON_MARGIN_FROM_SELECTION = 5;
const ICON_BASE_SIZE = 24;
const DEBUG_PREFIX = '[CONTENT_DEBUG]';

const CAMBRIDGE_IGNORED_AUDIO_URL = 'https://dictionary.cambridge.org/media/english/uk_pron/u/ukz/ukzit/ukzit__004.mp3';

let currentSelectedTextForIcons = "";
let activeAudio = null;
const pageIcons = {};

function stopActiveAudio() {
    if (activeAudio) {
        if (!activeAudio.paused) {
            activeAudio.pause();
        }
        activeAudio.src = '';
        activeAudio.load();
        activeAudio = null;
    }
}

function playAudioFromUrl(url) {
    stopActiveAudio();
    return new Promise((resolve, reject) => {
        if (!url) {
            return reject(new Error('Invalid audio URL.'));
        }
        try {
            activeAudio = new Audio(url);
            activeAudio.play()
                .then(() => {
                    activeAudio.onended = resolve;
                    activeAudio.onerror = (e) => reject(new Error(`Audio playback error: ${e.message || 'Unknown'}`));
                })
                .catch(reject);
        } catch (e) {
            reject(e);
        }
    });
}

function createIconElement(iconConfig) {
    let iconEl = document.getElementById(iconConfig.id);
    if (!iconEl) {
        iconEl = document.createElement('img');
        iconEl.id = iconConfig.id;
        iconEl.classList.add('page-action-icon');
        try {
            iconEl.src = chrome.runtime.getURL(iconConfig.fileName.startsWith('/') ? iconConfig.fileName : `/${iconConfig.fileName}`);
        } catch (e) {
            console.error(DEBUG_PREFIX, `Error getting URL for icon "${iconConfig.fileName}":`, e.message);
            return null;
        }
        document.body.appendChild(iconEl);
        iconEl.addEventListener('mousedown', (event) => event.stopPropagation());
        iconEl.addEventListener('click', (event) => {
            event.stopPropagation();
            handleIconClick(iconConfig);
        });
    }
    iconEl.style.display = 'none';
    pageIcons[iconConfig.key] = iconEl;
    return iconEl;
}

function initializePageIcons() {
    if (!document.body) {
        return;
    }
    createIconElement(ICON_DEFINITIONS.LOOKUP);
}

function updateIconTitles(text) {
    if (typeof text !== 'string') return;
    const iconEl = pageIcons[ICON_DEFINITIONS.LOOKUP.key];
    if (iconEl) {
        iconEl.title = ICON_DEFINITIONS.LOOKUP.titleTemplate.replace('{text}', text);
    }
}

function positionIcons(baseRect) {
    if (!baseRect) return;
    const lookupIconEl = pageIcons[ICON_DEFINITIONS.LOOKUP.key];
    if (!lookupIconEl) return;
    const iconWidth = lookupIconEl.offsetWidth || ICON_BASE_SIZE;
    const iconHeight = lookupIconEl.offsetHeight || ICON_BASE_SIZE;
    let top = baseRect.bottom + window.scrollY + ICON_MARGIN_FROM_SELECTION;
    let left = baseRect.left + window.scrollX + (baseRect.width / 2) - (iconWidth / 2);
    
    lookupIconEl.style.top = `${Math.round(top)}px`;
    lookupIconEl.style.left = `${Math.round(left)}px`;
    lookupIconEl.style.display = 'block';
}

function showActivePageIcons(selectionObject, text, rect) {
    if (!text || !rect) {
        hideAllPageIcons();
        return;
    }
    currentSelectedTextForIcons = text;
    updateIconTitles(text);
    positionIcons(rect);
}

function hideAllPageIcons() {
    const lookupIconEl = pageIcons[ICON_DEFINITIONS.LOOKUP.key];
    if (lookupIconEl && lookupIconEl.style) {
        lookupIconEl.style.display = 'none';
    }
    currentSelectedTextForIcons = "";
    stopActiveAudio();
}

function handleIconClick(iconConfig) {
    if (!currentSelectedTextForIcons || !iconConfig) return;
    try {
        chrome.runtime.sendMessage({
            action: iconConfig.messageAction,
            query: currentSelectedTextForIcons
        });
    } catch (e) {
        console.error(DEBUG_PREFIX, `Error sending message for ${iconConfig.messageAction}:`, e.message);
    }
    if (iconConfig.hideIconsPostAction) {
        hideAllPageIcons();
    }
}

function handleDocumentSelectionChange() {
    const selection = window.getSelection();
    const selectedText = selection ? selection.toString().trim() : "";
    try {
        chrome.runtime.sendMessage({ action: MESSAGE_ACTIONS.UPDATE_SELECTED_TEXT, text: selectedText });
    } catch (e) { /* Ignore */ }
    if (!selectedText || currentSelectedTextForIcons !== selectedText) {
        hideAllPageIcons();
    }
}

async function handleDocumentDoubleClick(event) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const selectedText = selection.toString().trim();
    if (!selectedText) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) return;

    showActivePageIcons(selection, selectedText, rect);

    try {
        const response = await chrome.runtime.sendMessage({ action: MESSAGE_ACTIONS.GET_CAMBRIDGE_AUDIO_URL, query: selectedText });
        if (response?.audioUrl && response.audioUrl !== CAMBRIDGE_IGNORED_AUDIO_URL) {
            await playAudioFromUrl(response.audioUrl);
        } else {
            console.log(DEBUG_PREFIX, `No valid audio found for "${selectedText}".`);
        }
    } catch (e) {
        console.error(DEBUG_PREFIX, `Error requesting or playing Cambridge audio:`, e);
    }
}

function handleDocumentMouseDown(event) {
    const clickedOnOurIcon = Object.values(pageIcons).some(iconEl => iconEl && event.target === iconEl);
    if (!clickedOnOurIcon) {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
            hideAllPageIcons();
        }
    }
}

function handleRuntimeMessages(request, sender, sendResponse) {
    if (request.action === MESSAGE_ACTIONS.QUERY_SELECTED_TEXT) {
        const textToRespond = window.getSelection()?.toString().trim() || "";
        sendResponse({ text: textToRespond });
    }
    return false;
}

function main() {
    if (document.body) {
        initializePageIcons();
    } else {
        document.addEventListener('DOMContentLoaded', initializePageIcons, { once: true });
    }
    document.addEventListener('selectionchange', handleDocumentSelectionChange, { passive: true });
    document.addEventListener('dblclick', handleDocumentDoubleClick);
    document.addEventListener('mousedown', handleDocumentMouseDown, { capture: true });
    if (chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener(handleRuntimeMessages);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main, { once: true });
} else {
    main();
}