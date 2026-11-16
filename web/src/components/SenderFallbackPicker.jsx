import React from 'react';

export default function SenderFallbackPicker({ senders, primaryId, enabled, selectedIds, onChange, perSenderLimit = 450, capacity = [] }) {
  const alternatives = senders.filter(sender => sender.id !== primaryId);
  return <fieldset className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
    <legend className="px-1 text-sm font-bold text-zinc-200">Sender fallback</legend>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={enabled} disabled={!alternatives.length} onChange={event => onChange(event.target.checked, event.target.checked ? selectedIds : [])} /><span>Automatically switch between approved sender accounts when a daily limit is reached</span></label>
    {!alternatives.length && <p className="text-xs text-zinc-400">Add another owned SMTP account in Settings to use automatic fallback.</p>}
    {enabled && <>
      <p className="text-xs text-zinc-400">The primary account is included. Select additional accounts below; approve the exact list in the preview. Each sender has a {perSenderLimit}/day app limit, shared across its campaigns. Existing pacing and provider restrictions still apply.</p>
      {alternatives.map(sender => {
        const status = capacity.find(row => row._id === sender.id);
        return <label key={sender.id} className="flex items-start gap-2 rounded border border-zinc-700 p-2.5 text-xs"><input aria-label={`Approve fallback ${sender.email}`} className="mt-1" type="checkbox" checked={selectedIds.includes(sender.id)} onChange={event => onChange(true, event.target.checked ? [...selectedIds, sender.id] : selectedIds.filter(id => id !== sender.id))} /><span className="min-w-0 break-words"><strong>{sender.name || sender.email}</strong><br />{sender.email}{status && <span className="block text-zinc-400">{status.remaining} app-tracked slots left today (UTC)</span>}</span></label>;
      })}
      <p className="text-xs text-zinc-400">Switching is allowed only within this reviewed list. If all accounts are full, the queue continues after the UTC quota reset. Uncertain deliveries require review rather than a retry from another account.</p>
    </>}
  </fieldset>;
}
