// MV3 service worker: wires the toolbar button and the right-click menu to the side panel.
// It never reads page content on its own; it only receives text the user selected and chose
// to send to Muninn, which is why the extension needs no host permissions.

const MENU_ID = 'muninn-read';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Ask Muninn about this message',
    contexts: ['selection'],
  });
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) return;
  // sidePanel.open must run synchronously inside the user gesture, before any await.
  if (tab?.windowId !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
  }
  chrome.storage.session
    .set({ pendingMessage: { text: info.selectionText, at: Date.now() } })
    .catch(console.error);
});
