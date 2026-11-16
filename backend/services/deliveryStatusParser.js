// This extracts structured DSN evidence for review. It handles RFC 3464 format,
// Gmail delivery failure notices, and distinguishes permanent 5.1.1 "address not found"
// from temporary or mailbox-full failures.
function parseDeliveryStatus(raw) {
  if (typeof raw !== 'string' || raw.length > 100000) return [];
  const text = raw.replace(/\r\n[ \t]+/g, ' ');
  const messageId = text.match(/^(?:Original-Message-ID|X-Original-Message-ID|Message-ID):\s*(<[^\r\n>]+>)/im)?.[1];
  const results = [];
  for (const block of text.split(/\r?\n\s*\r?\n/)) {
    const recipient = block.match(/^(?:Final-Recipient|Original-Recipient):\s*(?:rfc822;\s*)?([^\s<>]+@[^\s<>]+)/im)?.[1];
    const status = block.match(/^Status:\s*([245]\.\d{1,3}\.\d{1,3})\s*$/im)?.[1];
    const action = block.match(/^Action:\s*(failed|delayed|delivered|relayed|expanded)\s*$/im)?.[1]?.toLowerCase();
    const diag = block.match(/^Diagnostic-Code:\s*(.+)$/im)?.[1];
    if (recipient && (status || action)) {
      results.push({
        recipientEmail: recipient.toLowerCase(),
        enhancedStatus: status || null,
        action: action || 'failed',
        diagnosticCode: diag ? diag.trim() : null,
        messageId: messageId || null
      });
    }
  }
  return results.slice(0, 100);
}

function isConfirmedAddressNotFound(status, diagnosticCode = '', bodyText = '') {
  const combined = `${status || ''} ${diagnosticCode || ''} ${bodyText || ''}`.toLowerCase();
  
  // Explicitly temporary or non-invalid failures must NOT be treated as address-not-found
  if (/mailbox (is )?full|quota exceeded|exceeded storage|5\.2\.2|4\.2\.2/.test(combined)) return false;
  if (/^[4]\.\d{1,3}\.\d{1,3}/.test(status || '') || /temporary failure|greylist|try again later|connection timed out|4\.4\.\d/.test(combined)) return false;
  
  // Permanent recipient-not-found indicators
  if (/^5\.1\.(0|1|2|3|10)$/.test(status || '')) return true;
  if (/550[ -]5\.1\.1|550 5\.1\.0/.test(combined)) return true;
  if (/address (not found|could not be found|does not exist)/i.test(combined)) return true;
  if (/user unknown|no such user|recipient not found|mailbox unavailable|account that you tried to reach does not exist/i.test(combined)) return true;
  
  return false;
}

module.exports = { parseDeliveryStatus, isConfirmedAddressNotFound };

