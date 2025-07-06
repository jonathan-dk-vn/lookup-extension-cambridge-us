// background.js (English-Only Version, Updated with Headword Check)

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

chrome.runtime.onInstalled.addListener(() => {
  console.log(BG_DEBUG_PREFIX, 'Extension installed or updated.');
  chrome.contextMenus.create({
    id: "lookupInCambridge",
    title: "Lookup in Cambridge",
    contexts: ["selection"]
  });
  console.log(BG_DEBUG_PREFIX, 'Context menu "lookupInCambridge" created.');
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  console.log(BG_DEBUG_PREFIX, 'Context menu clicked:', info);
  if (info.menuItemId === "lookupInCambridge" && info.selectionText) {
    const query = encodeURIComponent(info.selectionText.trim());
    const url = `https://dictionary.cambridge.org/dictionary/english/${query}`;
    console.log(BG_DEBUG_PREFIX, `Adding to lookup queue (context menu): ${url}`);
    addLookupToQueue(url);
  }
});

async function processLookupQueue() {
    if (lookupQueue.length === 0 || isProcessingLookup) {
        return;
    }
    const nextUrl = lookupQueue.shift();
    console.log(BG_DEBUG_PREFIX, `Processing next URL from queue: ${nextUrl}`);
    await executeOpenOrUpdateLookupTab(nextUrl);
}

async function executeOpenOrUpdateLookupTab(url) {
    console.log(BG_DEBUG_PREFIX, `Executing open/update lookup tab for URL: ${url}`);
    isProcessingLookup = true;
    try {
        if (lookupTabId !== null) {
            try {
                const existingTab = await chrome.tabs.get(lookupTabId);
                if (existingTab && existingTab.url && existingTab.url.startsWith("https://dictionary.cambridge.org/")) {
                    console.log(BG_DEBUG_PREFIX, `Updating existing lookup tab (ID: ${lookupTabId}) to URL: ${url}`);
                    await chrome.tabs.update(lookupTabId, { url: url, active: true });
                    if (existingTab.windowId) {
                        await chrome.windows.update(existingTab.windowId, { focused: true });
                    }
                    return;
                }
            } catch (error) {
                console.warn(BG_DEBUG_PREFIX, `Error interacting with tab ${lookupTabId}: ${error}. Will create new tab.`);
                lookupTabId = null;
            }
        }
        console.log(BG_DEBUG_PREFIX, `Creating new lookup tab for URL: ${url}`);
        const newTab = await chrome.tabs.create({ url: url, active: true });
        if (newTab && typeof newTab.id === 'number') {
            lookupTabId = newTab.id;
            console.log(BG_DEBUG_PREFIX, `New lookup tab created with ID: ${lookupTabId}`);
            if (newTab.windowId) {
                 await chrome.windows.update(newTab.windowId, { focused: true });
            }
        } else {
            console.warn(BG_DEBUG_PREFIX, 'Failed to create new tab or get its ID.');
            lookupTabId = null;
        }
    } catch (error) {
        console.error(BG_DEBUG_PREFIX, "Critical error in executeOpenOrUpdateLookupTab:", error, "URL:", url);
        lookupTabId = null;
    } finally {
        isProcessingLookup = false;
        queueMicrotask(processLookupQueue);
    }
}

function addLookupToQueue(url) {
    lookupQueue.push(url);
    console.log(BG_DEBUG_PREFIX, `URL added to queue. Queue length: ${lookupQueue.length}`);
    if (!isProcessingLookup) {
        processLookupQueue();
    }
}

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (tabId === lookupTabId) {
    console.log(BG_DEBUG_PREFIX, `Lookup tab (ID: ${tabId}) was removed. Resetting lookupTabId.`);
    lookupTabId = null;
  }
});

async function fetchAndParseCambridgeAudioUrl(queryWord) {
    const cambridgePageUrl = `https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(queryWord.toLowerCase())}`;
    console.log(BG_DEBUG_PREFIX, `Cambridge: Fetching URL: ${cambridgePageUrl}`);
    try {
        const response = await fetch(cambridgePageUrl);
        if (!response.ok) {
            console.error(BG_DEBUG_PREFIX, `Cambridge: Failed to fetch page ${response.status} for word: ${queryWord}`);
            return null;
        }
        const htmlText = await response.text();

        // ** Bắt đầu logic mới: Kiểm tra headword **
        // 1. Trích xuất headword từ trang.
        const headwordRegex = /<span class="hw dhw">([^<]+)<\/span>/i;
        const headwordMatch = htmlText.match(headwordRegex);
        
        if (!headwordMatch || !headwordMatch[1]) {
            console.warn(BG_DEBUG_PREFIX, `Cambridge: Không thể tìm thấy headword trên trang cho từ: ${queryWord}`);
            return null; // Không tìm thấy headword, không phát âm thanh.
        }

        const pageHeadword = headwordMatch[1].trim().toLowerCase();
        const requestedWord = queryWord.trim().toLowerCase();

        // 2. So sánh từ được nhấp đúp với headword của trang.
        if (pageHeadword !== requestedWord) {
            console.log(BG_DEBUG_PREFIX, `Cambridge: Từ được nhấp đúp "${requestedWord}" không khớp với headword của trang "${pageHeadword}". Sẽ không phát âm thanh.`);
            return null; // Không phát âm thanh nếu từ chính trên trang khác.
        }
        // ** Kết thúc logic mới **

        // Logic tìm URL âm thanh (chỉ chạy nếu headword khớp)
        const usAudioRegex = /<span class="us dpron-i.*?<source[^>]*?src="([^"]+\.mp3)"/s;
        const usMatch = htmlText.match(usAudioRegex);
        if (usMatch && usMatch[1]) {
            const audioUrl = usMatch[1].startsWith('http') ? usMatch[1] : `https://dictionary.cambridge.org${usMatch[1]}`;
            console.log(BG_DEBUG_PREFIX, `Cambridge: Đã tìm thấy URL MP3 (US): ${audioUrl}`);
            return audioUrl;
        }

        const ukAudioRegex = /<span class="uk dpron-i.*?<source[^>]*?src="([^"]+\.mp3)"/s;
        const ukMatch = htmlText.match(ukAudioRegex);
        if (ukMatch && ukMatch[1]) {
            const audioUrl = ukMatch[1].startsWith('http') ? ukMatch[1] : `https://dictionary.cambridge.org${ukMatch[1]}`;
            console.warn(BG_DEBUG_PREFIX, `Cambridge: Không tìm thấy âm thanh US. Sử dụng âm thanh UK: ${audioUrl}`);
            return audioUrl;
        }
        
        console.warn(BG_DEBUG_PREFIX, `Cambridge: Không tìm thấy URL âm thanh nào cho: ${queryWord}.`);
        return null;

    } catch (error) {
        console.error(BG_DEBUG_PREFIX, `Cambridge: Lỗi khi tải hoặc phân tích trang cho từ ${queryWord}:`, error);
        return null;
    }
}


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log(BG_DEBUG_PREFIX, 'Message received:', request);
  if (request.action === MESSAGE_ACTIONS.UPDATE_SELECTED_TEXT) {
    lastSelectedText = request.text;
    return false;
  } else if (request.action === MESSAGE_ACTIONS.GET_SELECTED_TEXT) {
    if (request.tabId && sender.tab && sender.tab.id === request.tabId) {
        chrome.tabs.sendMessage(request.tabId, { action: MESSAGE_ACTIONS.QUERY_SELECTED_TEXT }, (response) => {
            if (chrome.runtime.lastError) {
                sendResponse({ text: lastSelectedText || "" });
            } else if (response && typeof response.text !== 'undefined') {
                sendResponse({ text: response.text });
            } else {
                sendResponse({ text: lastSelectedText || "" });
            }
        });
        return true;
    } else {
         sendResponse({ text: lastSelectedText || "" });
         return false;
    }
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
        })
        .catch(error => {
          sendResponse({ audioUrl: null });
        });
    } else {
      sendResponse({ audioUrl: null });
    }
    return true;
  }
  return false;
});