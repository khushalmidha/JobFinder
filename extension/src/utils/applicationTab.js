export async function sendToApplicationTab(tab, request) {
  const url = new URL(tab.url);
  if (!['http:', 'https:'].includes(url.protocol) || /(^|\.)linkedin\.com$/i.test(url.hostname))
    throw new Error('Open a supported application form first.');
  const send = payload => chrome.tabs.sendMessage(tab.id, payload, { frameId: 0 });
  try {
    return await send(request);
  } catch (error) {
    if (!/Receiving end does not exist/.test(error.message)) throw error;
  }
  const current = await chrome.tabs.get(tab.id);
  if (current.url !== tab.url) throw new Error('The tab navigated. Open the form again.');
  const files = chrome.runtime.getManifest().content_scripts[0].js;
  await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files });
  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 70));
    try {
      const status = await send({ action: 'JF_STATUS' });
      if (status?.success) {
        if ((await chrome.tabs.get(tab.id)).url !== tab.url) throw new Error('The tab navigated. Open the form again.');
        return request.action === 'JF_STATUS' ? status : send(request);
      }
    } catch (error) {
      if (!/Receiving end does not exist/.test(error.message)) throw error;
    }
  }
  throw new Error('Smart Apply did not load on this tab. Check the site permissions in Brave.');
}
