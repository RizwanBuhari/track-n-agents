// An email draft waiting for a person: edit, translate, approve (sends it)
// or reject with a note (the planner revises the plan using the note).
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { Icon } from './icons'
import { Priority } from './ui'

const COMMON_LANGUAGES = ['Arabic', 'Chinese (Simplified)', 'Chinese (Traditional)', 'Dutch', 'English', 'French', 'German', 'Hindi', 'Indonesian', 'Italian', 'Japanese', 'Korean', 'Malay', 'Polish', 'Portuguese', 'Russian', 'Spanish', 'Swedish', 'Tamil', 'Thai', 'Turkish', 'Urdu', 'Vietnamese']
const ORIGINAL_SEPARATOR = '\n\n---\nEnglish version:\n\n'

export default function DraftCard({ draft, showCase, onDone }) {
  const [subject, setSubject] = useState(draft.subject)
  const [body, setBody] = useState(draft.body)
  const [note, setNote] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [langs, setLangs] = useState(null)
  const [language, setLanguage] = useState('')
  const [includeOriginal, setIncludeOriginal] = useState(true)
  const [translated, setTranslated] = useState(null) // language the text is currently in, when not English
  const [english, setEnglish] = useState(null) // the English text, kept so a translation can be reverted

  useEffect(() => {
    let live = true
    api.get(`/drafts/${draft.id}/languages`).then((r) => {
      if (!live) return
      setLangs(r)
      setLanguage((cur) => cur || r.suggested[0]?.language || '')
    }).catch(() => {})
    return () => { live = false }
  }, [draft.id])

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

  async function translate() {
    // Always translate from the English text, never from an earlier translation.
    const source = english ?? { subject, body }
    setBusy(true)
    setError('')
    try {
      const r = await api.post(`/drafts/${draft.id}/translate`, { language, subject: source.subject, body: source.body, includeOriginal })
      setEnglish(source)
      setSubject(r.subject)
      setBody(r.body)
      setTranslated(r.language)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  // The English original sits below this separator (same text the backend appends).
  function toggleOriginal(keep) {
    setIncludeOriginal(keep)
    if (!translated || !english) return
    const at = body.indexOf(ORIGINAL_SEPARATOR)
    if (!keep && at >= 0) setBody(body.slice(0, at).trimEnd())
    if (keep && at < 0) setBody(`${body.trimEnd()}${ORIGINAL_SEPARATOR}${english.body.trim()}`)
  }

  function revert() {
    setSubject(english.subject)
    setBody(english.body)
    setEnglish(null)
    setTranslated(null)
  }

  const isEnglish = /^english$/i.test(language.trim())

  return (
    <div className="draft-card">
      <div className="draft-head">
        <span className={`badge tone-${draft.purpose === 'escalation' ? 'alert' : draft.purpose === 'reminder' ? 'neutral' : 'warn'}`}>{draft.purpose.replace('_', '-')}</span>
        {showCase && draft.priority && <Priority p={draft.priority} compact />}
        <span className="draft-to">To <strong>{draft.to}</strong>{draft.cc && <> · cc {draft.cc}</>}</span>
        {translated && <span className="badge tone-info">Translated · {translated}</span>}
        {showCase && <Link to={`/cases/${draft.caseId}`} className="table-link">{draft.caseId}</Link>}
      </div>

      <div className="translate-bar">
        <span className="translate-label">{Icon.globe} Language</span>
        {langs?.suggested.map((s) => (
          <button key={s.language} type="button" className={`lang-chip${language === s.language ? ' lang-chip-on' : ''}`} title={s.reason} disabled={busy} onClick={() => setLanguage(s.language)}>
            {s.language}
          </button>
        ))}
        <input type="text" list={`langs-${draft.id}`} placeholder="Any language" value={language} onChange={(e) => setLanguage(e.target.value)} disabled={busy} />
        <datalist id={`langs-${draft.id}`}>{COMMON_LANGUAGES.map((l) => <option key={l} value={l} />)}</datalist>
        <label className="translate-check">
          <input type="checkbox" checked={includeOriginal} onChange={(e) => toggleOriginal(e.target.checked)} disabled={busy} /> Keep English below
        </label>
        <button type="button" className="btn-secondary btn-small" disabled={busy || !language.trim() || isEnglish} onClick={translate}>Translate</button>
        {english && <button type="button" className="link-button" disabled={busy} onClick={revert}>Revert to English</button>}
        {langs?.suggested[0] && langs.suggested[0].language !== 'English' && (
          <span className="text-muted">Suggested: {langs.suggested[0].language} ({langs.suggested[0].reason})</span>
        )}
      </div>

      <input className="draft-subject" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={busy} />
      <textarea className="draft-body" value={body} onChange={(e) => setBody(e.target.value)} rows={translated && includeOriginal ? 14 : 8} disabled={busy} />
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
          <button className="btn-primary" disabled={busy} onClick={() => act(() => api.post(`/drafts/${draft.id}/approve`, { subject: subject !== draft.subject ? subject : undefined, body: body !== draft.body ? body : undefined, language: translated || undefined }))}>
            {busy ? <span className="spinner spinner-light" /> : Icon.send} {translated ? `Approve and send in ${translated}` : 'Approve and send'}
          </button>
          <button className="btn-outline" disabled={busy} onClick={() => setRejecting(true)}>{Icon.x} Reject</button>
        </div>
      )}
    </div>
  )
}
