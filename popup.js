// popup.js (English-Only Version)
const MESSAGE_ACTIONS = {
  GET_SELECTED_TEXT: 'getSelectedText'
};

document.addEventListener('DOMContentLoaded', () => {
  const searchBox = document.getElementById('search-box');

  // Get selected text from the active tab when the popup opens
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs.length > 0 && tabs[0].id) {
      const activeTabId = tabs[0].id;
      chrome.runtime.sendMessage({ action: MESSAGE_ACTIONS.GET_SELECTED_TEXT, tabId: activeTabId }, (response) => {
        if (response && response.text) {
          searchBox.value = response.text;
        }
        searchBox.focus();
        searchBox.select();
      });
    } else {
      searchBox.focus();
    }
  });

  // Function to perform the lookup
  function performSearch(queryText) {
    if (queryText && queryText.trim()) {
      chrome.runtime.sendMessage({
          action: 'openLookupTab',
          query: queryText.trim()
      });
      window.close(); // Close popup after search
    }
  }

  // Handle keyboard events
  searchBox.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      performSearch(searchBox.value.trim());
    }
  });
});