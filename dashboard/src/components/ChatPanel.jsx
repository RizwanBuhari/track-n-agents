// The assistant: a slide-over panel reachable from every page. Read-only:
// it answers from case evidence (and one Zetaris lookup when needed) and
// cannot send emails or close cases.
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../api'
import { Icon } from './icons'

const SUGGESTIONS = [
  'Which cases are waiting on someone right now?',
  'Why is this shipment held?',
  'What are we waiting for to close this case?',
]

export default function ChatPanel() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bodyRef = useRef(null)
  const inputRef = useRef(null)
  const location = useLocation()
  const caseId = location.pathname.match(/^\/cases\/(TN-\d{4})/)?.[1]
  const awb = location.pathname.match(/^\/shipments\/([\d-]+)/)?.[1]

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [messages, busy])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  async function send(text) {
    const question = (text ?? input).trim()
    if (!question || busy) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', text: question }])
    setBusy(true)
    try {
      const { answer, sources } = await api.post('/chat', { question, caseId, awb })
      setMessages((m) => [...m, { role: 'assistant', text: answer, sources }])
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', error: true, text: `Could not reach the assistant. ${err.message}` }])
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button className="chat-fab" onClick={() => setOpen(true)} title="Ask the assistant" aria-label="Ask the assistant">
        {Icon.chat}
        <span>Ask</span>
      </button>
    )
  }

  return (
    <aside className="chat-panel" role="dialog" aria-label="Assistant">
      <header className="chat-head">
        <div className="chat-head-id">
          <span className="chat-avatar" aria-hidden="true">{Icon.chat}</span>
          <div>
            <strong>Assistant</strong>
            <span className="chat-sub">
              <span className="chat-status-dot" aria-hidden="true" />
              {caseId ? `Looking at ${caseId}` : awb ? `Looking at AWB ${awb}` : 'Answers from case evidence'} · read-only
            </span>
          </div>
        </div>
        <button className="chat-close" onClick={() => setOpen(false)} aria-label="Close">×</button>
      </header>

      <div className="chat-body" ref={bodyRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>Ask about any shipment or case. I answer from the evidence the agents collected and cite it. I cannot send emails or close cases.</p>
            <div className="chat-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} disabled={busy}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-${m.role}${m.error ? ' chat-error' : ''}`}>
            <div className="chat-text">{m.text}</div>
            {m.sources?.length > 0 && <div className="chat-sources">Sources: {m.sources.join(', ')}</div>}
          </div>
        ))}
        {busy && (
          <div className="chat-msg chat-assistant chat-typing" aria-label="Assistant is typing">
            <span /><span /><span />
          </div>
        )}
      </div>

      <div className="chat-input">
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          placeholder="Ask about a shipment or case…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          disabled={busy}
        />
        <button className="chat-send" onClick={() => send()} disabled={busy || !input.trim()} aria-label="Send" title="Send">
          {Icon.send}
        </button>
      </div>
    </aside>
  )
}
