// background.js (English-Only Version, Upgraded with Final Lemmatisation Logic)

const MESSAGE_ACTIONS = {
  UPDATE_SELECTED_TEXT: 'updateSelectedText',
  GET_SELECTED_TEXT: 'getSelectedText',
  QUERY_SELECTED_TEXT: 'querySelectedText',
  OPEN_LOOKUP_TAB: 'openLookupTab',
  GET_CAMBRIDGE_AUDIO_URL: 'getCambridgeAudioUrl'
};

const BG_DEBUG_PREFIX = '[BACKGROUND_DEBUG]';

let lookupTabId = null;
let lastSelectedText = "";
let isProcessingLookup = false;
const lookupQueue = [];

// --- Context Menu and Tab Management (Original from Project 1) ---
chrome.runtime.onInstalled.addListener(() => {
  console.log(BG_DEBUG_PREFIX, 'Extension installed or updated.');
  chrome.contextMenus.create({
    id: "lookupInCambridge",
    title: "Lookup in Cambridge",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "lookupInCambridge" && info.selectionText) {
    const query = encodeURIComponent(info.selectionText.trim());
    const url = `https://dictionary.cambridge.org/dictionary/english/${query}`;
    addLookupToQueue(url);
  }
});

async function processLookupQueue() {
    if (lookupQueue.length === 0 || isProcessingLookup) return;
    const nextUrl = lookupQueue.shift();
    await executeOpenOrUpdateLookupTab(nextUrl);
}

async function executeOpenOrUpdateLookupTab(url) {
    isProcessingLookup = true;
    try {
        if (lookupTabId !== null) {
            try {
                const existingTab = await chrome.tabs.get(lookupTabId);
                if (existingTab && existingTab.url && existingTab.url.startsWith("https://dictionary.cambridge.org/")) {
                    await chrome.tabs.update(lookupTabId, { url: url, active: true });
                    if (existingTab.windowId) await chrome.windows.update(existingTab.windowId, { focused: true });
                    return;
                }
            } catch (error) {
                lookupTabId = null;
            }
        }
        const newTab = await chrome.tabs.create({ url: url, active: true });
        if (newTab && typeof newTab.id === 'number') {
            lookupTabId = newTab.id;
            if (newTab.windowId) await chrome.windows.update(newTab.windowId, { focused: true });
        } else {
            lookupTabId = null;
        }
    } catch (error) {
        console.error(BG_DEBUG_PREFIX, "Error managing lookup tab:", error);
        lookupTabId = null;
    } finally {
        isProcessingLookup = false;
        queueMicrotask(processLookupQueue);
    }
}

function addLookupToQueue(url) {
    lookupQueue.push(url);
    if (!isProcessingLookup) processLookupQueue();
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === lookupTabId) lookupTabId = null;
});


// --- START: Lemmatisation and Audio Fetching Logic (UPGRADED) ---

/**
 * Finds the base form of a common English word.
 * @param {string} word The word to process.
 * @returns {string|null} The potential base form or null if no simple rule applies.
 */
function findBaseForm(word) {
    const lowerWord = word.toLowerCase();
    if (lowerWord.length <= 3) return null;

    if (lowerWord.endsWith('s') && !lowerWord.endsWith('ss')) {
        if (lowerWord.endsWith('es')) {
            if (['s', 'x', 'z', 'ch', 'sh'].some(ending => lowerWord.endsWith(ending + 'es'))) {
                return word.slice(0, -2);
            }
            return word.slice(0, -1);
        }
        return word.slice(0, -1);
    }
    if (lowerWord.endsWith('ing')) {
        if (lowerWord.length > 5 && lowerWord.slice(-4, -3) === lowerWord.slice(-5, -4)) {
             return word.slice(0, -4);
        }
        return word.slice(0, -3);
    }
    if (lowerWord.endsWith('ed')) {
       if (lowerWord.length > 4 && lowerWord.slice(-3, -2) === lowerWord.slice(-4, -3)) {
            return word.slice(0, -3);
       }
       return word.slice(0, -2);
    }
    return null;
}

/**
 * Fetches Cambridge audio, trying the original word first, then a base form.
 */
async function fetchAndParseCambridgeAudioUrl(queryWord) {
    const attemptFetch = async (word) => {
        const cambridgePageUrl = `https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(word.toLowerCase())}`;
        try {
            const response = await fetch(cambridgePageUrl);
            if (!response.ok) return null;
            const htmlText = await response.text();

            const headwordRegex = /<span class="hw dhw">([^<]+)<\/span>/i;
            const headwordMatch = htmlText.match(headwordRegex);
            if (!headwordMatch || !headwordMatch[1] || headwordMatch[1].trim().toLowerCase() !== word.trim().toLowerCase()) {
                console.log(BG_DEBUG_PREFIX, `Cambridge: Word "${word}" does not match page's headword.`);
                return null;
            }

            const usAudioRegex = /<span class="us dpron-i.*?<source[^>]*?src="([^"]+\.mp3)"/s;
            const usMatch = htmlText.match(usAudioRegex);
            if (usMatch && usMatch[1]) {
                return usMatch[1].startsWith('http') ? usMatch[1] : `https://dictionary.cambridge.org${usMatch[1]}`;
            }

            const ukAudioRegex = /<span class="uk dpron-i.*?<source[^>]*?src="([^"]+\.mp3)"/s;
            const ukMatch = htmlText.match(ukAudioRegex);
            if (ukMatch && ukMatch[1]) {
                return ukMatch[1].startsWith('http') ? ukMatch[1] : `https://dictionary.cambridge.org${ukMatch[1]}`;
            }
            return null;
        } catch (error) {
            console.error(BG_DEBUG_PREFIX, `Cambridge: Error fetching page for ${word}:`, error);
            return null;
        }
    };

    // Step 1: Try the original word.
    let audioUrl = await attemptFetch(queryWord);
    if (audioUrl) {
        console.log(BG_DEBUG_PREFIX, `Cambridge: Success with original word "${queryWord}"`);
        return audioUrl;
    }

    // Step 2: If failed, try the base form.
    console.log(BG_DEBUG_PREFIX, `Cambridge: Failed to get audio for "${queryWord}". Attempting to find base form.`);
    const baseForm = findBaseForm(queryWord);
    if (baseForm && baseForm.toLowerCase() !== queryWord.toLowerCase()) {
        console.log(BG_DEBUG_PREFIX, `Cambridge: Found potential base form: "${baseForm}". Retrying...`);
        audioUrl = await attemptFetch(baseForm);
        if (audioUrl) {
            console.log(BG_DEBUG_PREFIX, `Cambridge: Success with base form "${baseForm}"`);
            return audioUrl;
        }
    }
    
    console.log(BG_DEBUG_PREFIX, `Cambridge: All attempts failed for "${queryWord}".`);
    return null;
}

// --- END: UPGRADED Logic ---


// --- Original Message Listener from Project 1 ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === MESSAGE_ACTIONS.UPDATE_SELECTED_TEXT) {
    lastSelectedText = request.text;
    return false;
  } else if (request.action === MESSAGE_ACTIONS.GET_SELECTED_TEXT) {
    sendResponse({ text: lastSelectedText || "" });
    return false;
  } else if (request.action === MESSAGE_ACTIONS.OPEN_LOOKUP_TAB) {
    if (request.query) {
      const query = encodeURIComponent(request.query.trim());
      const url = `https://dictionary.cambridge.org/dictionary/english/${query}`;
      addLookupToQueue(url);
    }
    return false;
  } else if (request.action === MESSAGE_ACTIONS.GET_CAMBRIDGE_AUDIO_URL) {
    if (request.query) {
      fetchAndParseCambridgeAudioUrl(request.query)
        .then(audioUrl => {
          sendResponse({ audioUrl: audioUrl });
        });
    } else {
      sendResponse({ audioUrl: null });
    }
    return true; // Keep channel open for async response
  }
  return false;
});