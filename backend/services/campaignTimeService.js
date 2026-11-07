function formatter(timezone) {
  if (typeof timezone !== 'string' || (!timezone.includes('/') && timezone !== 'UTC')) throw new Error('Select an IANA timezone');
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }); }
  catch { throw new Error('Invalid IANA timezone'); }
}
function partsUtc(format, time) {
  const p = Object.fromEntries(format.formatToParts(time).map(v => [v.type,v.value]));
  return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);
}
function localTimeToUtc(local, timezone) {
  if (typeof local !== 'string' || !/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error('Use a valid local date and time (YYYY-MM-DDTHH:mm)');
  const naive = new Date(local+'Z');
  if (!Number.isFinite(+naive) || naive.toISOString().slice(0,16) !== local) throw new Error('Invalid calendar date or time');
  const f=formatter(timezone), offsets=new Set();
  // Observe both sides of any transition near the requested date, including
  // half/quarter-hour zones and non-hour DST shifts. Never silently choose a fold.
  for(let h=-48;h<=48;h+=6) { const t=+naive+h*3600000; offsets.add(partsUtc(f,t)-t); }
  const candidates=[...offsets].map(offset=>new Date(+naive-offset)).filter(t=>partsUtc(f,t)===+naive);
  if(candidates.length!==1) throw new Error(candidates.length ? 'Ambiguous daylight-saving time; choose an unambiguous local time' : 'Local time does not exist in this timezone');
  return candidates[0];
}
module.exports={localTimeToUtc};
