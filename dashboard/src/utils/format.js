export const CASE_STATUS = {
  INVESTIGATING: { label: 'Investigating', tone: 'info' },
  AWAITING_APPROVAL: { label: 'Awaiting approval', tone: 'warn' },
  WAITING_REPLY: { label: 'Waiting for reply', tone: 'neutral' },
  AWAITING_ARRIVAL: { label: 'Awaiting arrival', tone: 'info' },
  WAITING_ON_ISSUER: { label: 'Waiting on issuer', tone: 'neutral' },
  VERIFYING: { label: 'Verifying', tone: 'info' },
  READY_TO_CLOSE: { label: 'Ready to close', tone: 'good' },
  ESCALATED: { label: 'Escalated', tone: 'alert' },
  STALLED: { label: 'Stalled', tone: 'alert' },
  RESOLVED: { label: 'Resolved', tone: 'good' },
  CLOSED_UNRESOLVED: { label: 'Closed unresolved', tone: 'neutral' },
}

export const PROBLEM_LABEL = {
  MISSING_INVOICE: 'Missing invoice',
  INVOICE_REF_MISMATCH: 'Wrong invoice reference',
  TRANSPORT_DELAY: 'Transport delay',
  CONFLICTING_STATUS: 'Conflicting status',
  HS_CODE_ERROR: 'Wrong HS code',
  WEIGHT_MISMATCH: 'Weight mismatch',
  MISSING_CERTIFICATE: 'Missing certificate',
}

export const REPLY_TONE = {
  RESOLUTION_EVIDENCE: 'good',
  PROGRESS_UPDATE: 'info',
  PARTIAL: 'warn',
  VAGUE: 'warn',
  UNSUBSTANTIATED: 'warn',
  CONFLICTING: 'warn',
  WRONG_DOCUMENT: 'alert',
  UNVERIFIED_SENDER: 'alert',
  DUPLICATE: 'neutral',
}

export const AGENT = {
  investigation: { label: 'Investigation', tone: 'info' },
  planning: { label: 'Planning', tone: 'brand' },
  communication: { label: 'Communication', tone: 'warn' },
  verification: { label: 'Verification', tone: 'good' },
  coordinator: { label: 'Coordinator', tone: 'neutral' },
}

export const OPEN = ['INVESTIGATING', 'AWAITING_APPROVAL', 'WAITING_REPLY', 'AWAITING_ARRIVAL', 'WAITING_ON_ISSUER', 'VERIFYING', 'READY_TO_CLOSE', 'ESCALATED', 'STALLED']

export function when(iso) {
  if (!iso) return '—'
  const d = new Date(String(iso).includes(' ') && !/[zZ+]/.test(String(iso).slice(10)) ? String(iso).replace(' ', 'T') + 'Z' : iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function ago(iso) {
  if (!iso) return ''
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

export const kg = (v) => (v === null || v === undefined || v === '' ? '—' : `${Number(v).toFixed(1)} kg`)
