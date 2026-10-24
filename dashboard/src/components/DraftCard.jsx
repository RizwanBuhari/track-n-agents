// An email draft waiting for a person: edit, approve (sends it) or reject
// with a note (the planner revises the plan using the note).
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { Icon } from './icons'

export default function DraftCard({ draft, showCase, onDone }) {
  const [subject, setSubject] = useState(draft.subject)
  const [body, setBody] = useState(draft.body)
  const [note, setNote] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function act(fn) {
    setBusy(true)
    setError('')
    try {
      await fn()
      onDone?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="draft-card">
      <div className="draft-head">
        <span className={`badge tone-${draft.purpose === 'escalation' ? 'alert' : draft.purpose === 'reminder' ? 'neutral' : 'warn'}`}>{draft.purpose.replace('_', '-')}</span>
        <span className="draft-to">To <strong>{draft.to}</strong>{draft.cc && <> · cc {draft.cc}</>}</span>
        {showCase && <Link to={`/cases/${draft.caseId}`} className="table-link">{draft.caseId}</Link>}
      </div>
      <input className="draft-subject" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={busy} />
      <textarea className="draft-body" value={body} onChange={(e) => setBody(e.target.value)} rows={8} disabled={busy} />
      {draft.rationale && <p className="draft-why"><strong>Why:</strong> {draft.rationale}</p>}
      {error && <p className="error">{error}</p>}
      {rejecting ? (
        <div className="row-actions">
          <input className="grow" placeholder="Tell the planner what to change" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn-secondary" disabled={busy} onClick={() => act(() => api.post(`/drafts/${draft.id}/reject`, { note }))}>Send back</button>
          <button className="btn-outline" onClick={() => setRejecting(false)}>Cancel</button>
        </div>
      ) : (
        <div className="row-actions">
          <button className="btn-primary" disabled={busy} onClick={() => act(() => api.post(`/drafts/${draft.id}/approve`, { subject: subject !== draft.subject ? subject : undefined, body: body !== draft.body ? body : undefined }))}>
            {busy ? <span className="spinner spinner-light" /> : Icon.send} Approve and send
          </button>
          <button className="btn-outline" disabled={busy} onClick={() => setRejecting(true)}>{Icon.x} Reject</button>
        </div>
      )}
    </div>
  )
}
