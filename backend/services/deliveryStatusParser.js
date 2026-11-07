// This extracts structured DSN evidence for review. It does not authenticate the
// sender, perform a mailbox probe, or authorize any database mutation.
function parseDeliveryStatus(raw) {
  if (typeof raw !== 'string' || raw.length > 100000) return [];
  const text = raw.replace(/\r\n[ \t]+/g, ' ');
  const messageId = text.match(/^Original-Message-ID:\s*(<[^\r\n>]+>)/im)?.[1];
  const results = [];
  for (const block of text.split(/\r?\n\s*\r?\n/)) {
    const recipient = block.match(/^Final-Recipient:\s*rfc822;\s*([^\s<>]+@[^\s<>]+)/im)?.[1];
    const status = block.match(/^Status:\s*([245]\.\d{1,3}\.\d{1,3})\s*$/im)?.[1];
    const action = block.match(/^Action:\s*(failed|delayed|delivered|relayed|expanded)\s*$/im)?.[1]?.toLowerCase();
    if (recipient && status && action) results.push({ recipientEmail: recipient.toLowerCase(), enhancedStatus: status, action, messageId: messageId || null });
  }
  return results.slice(0, 100);
}
module.exports = { parseDeliveryStatus };
