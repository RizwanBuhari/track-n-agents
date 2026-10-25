import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, currentUserId, useLive } from '../api'
import DraftCard from '../components/DraftCard'
import { Icon } from '../components/icons'
import PageLoader from '../components/PageLoader'
import { AgentChip, CaseStatus, Evidence, Panel, Priority, Problem, ReplyType } from '../components/ui'
import { OPEN, PRIORITY_TONE, when } from '../utils/format'

function loopEvents(c) {
  const ev = []
  for (const v of c.verifications) ev.push({ at: v.at, kind: 'check', agent: 'verification', v })
  for (const p of c.plans) ev.push({ at: p.at, kind: 'plan', agent: 'planning', p })
  for (const d of c.drafts) ev.push({ at: d.createdAt, kind: 'draft', agent: 'communication', d })
  for (const e of c.emails) ev.push({ at: e.sentAt, kind: e.direction === 'outbound' ? 'sent' : 'reply', agent: 'communication', e })
  return ev.sort((a, b) => String(a.at).localeCompare(String(b.at)))
}

function TraceView({ runId }) {
  const { data } = useLive(() => api.get(`/runs/${runId}`), [runId])
  if (!data) return <span className="spinner" />
  return (
    <ol className="trace">
      {data.map((s, i) => (
        <li key={i} className={`trace-step trace-${s.kind}`}>
          <span className="trace-n">{s.kind === 'decision' || s.kind === 'note' ? '·' : s.n}</span>
          <AgentChip agent={s.agent} />
          <span className="trace-kind">{s.kind}</span>
          <span className="trace-summary">
            {s.summary}
            {s.detail?.servedBy && <em> served by {s.detail.servedBy}</em>}
            {s.detail?.sql && <code className="trace-sql">{s.detail.sql.replace(/\s+/g, ' ')}</code>}
          </span>
          {s.ms ? <span className="feed-ms">{(s.ms / 1000).toFixed(1)}s</span> : null}
        </li>
      ))}
    </ol>
  )
}

export default function CaseDetailPage() {
  const { id } = useParams()
  const { data: c, error, reload } = useLive(() => api.get(`/cases/${id}`), [id])
  const [openRun, setOpenRun] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  if (error) return <p className="error">{error}</p>
  if (!c) return <PageLoader />
  const isManager = currentUserId() === 'manager'
  const running = c.runs.some((r) => r.status === 'running')

  async function act(path, body) {
    setBusy(true)
    setActionError('')
    try {
      await api.post(path, body)
      reload()
    } catch (e) {
      setActionError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="reveal">
      <div className="page-header" style={{ marginBottom: 18 }}>
        <div className="page-head-left">
          <span className="page-lead tone-info">{Icon.alert}</span>
          <div>
            <h1 className="page-title">{c.caseId} · {c.title}</h1>
            <p className="page-hint">
              <Link to={`/shipments/${c.awbNo}`} className="table-link">AWB {c.awbNo}</Link> · owner {c.owner} · opened {when(c.openedAt)}
            </p>
          </div>
        </div>
        <div className="page-actions">
          {running && <span className="badge tone-warn"><span className="spinner" /> agents working</span>}
          {OPEN.includes(c.status) && <Priority p={c.priority} />}
          <CaseStatus status={c.status} />
          {c.escalated && <span className="badge tone-alert">escalated</span>}
        </div>
      </div>

      {c.flags?.length > 0 && (
        <div className="flag-list">
          {c.flags.map((f) => <p key={f} className="notice-warn">{Icon.alert}<span>{f}</span></p>)}
        </div>
      )}

      {c.status === 'READY_TO_CLOSE' && (
        <div className="close-bar">
          <span>{Icon.shield} Verification passed every closing check. {c.escalated ? 'The operations manager approves closure.' : 'A person approves closure.'}</span>
          <input placeholder="Closure note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn-primary" disabled={busy} onClick={() => act(`/cases/${c.caseId}/close`, { note })}>{Icon.check} Approve closure</button>
        </div>
      )}
      {['ESCALATED', 'STALLED'].includes(c.status) && (
        <div className="close-bar close-bar-alert">
          <span>{Icon.alert} {isManager ? 'Decide how this case continues.' : 'Waiting for the operations manager. Switch user at the top right to act as the manager.'}</span>
          {isManager && (
            <>
              <input placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn-secondary" disabled={busy} onClick={() => act(`/cases/${c.caseId}/manager`, { decision: 'extend', note })}>Extend & continue</button>
              <button className="btn-outline" disabled={busy} onClick={() => act(`/cases/${c.caseId}/manager`, { decision: 'close_unresolved', note })}>Close unresolved</button>
            </>
          )}
        </div>
      )}
      {actionError && <p className="error">{actionError}</p>}

      <div className="detail-grid">
        <div className="stack">
          <Panel icon={Icon.search} tone="info" title="Finding" actions={<><Problem type={c.problemType} /><span className="badge tone-neutral">{Math.round((c.confidence ?? 0) * 100)}% confidence</span></>}>
            <p className="finding-summary">{c.summary}</p>
            <p className="finding-text"><Evidence text={c.explanation} /></p>
          </Panel>

          {c.priority && (
            <Panel
              icon={Icon.zap}
              tone={PRIORITY_TONE[c.priority.level] ?? 'neutral'}
              title="Why this priority"
              actions={<>
                <span className="badge tone-neutral">severity {c.severityMethod === 'model' ? 'rated by Nemotron' : c.severityMethod === 'rules' ? 'rated by rules' : 'not yet rated'}</span>
                <button className="btn-outline btn-small" disabled={busy || running} onClick={() => act(`/cases/${c.caseId}/priority`)}>{Icon.refresh} Re-rate</button>
              </>}
            >
              <div className="priority-scores">
                <Priority p={c.priority} compact />
                <span><strong>Severity</strong> {c.priority.severity}/5</span>
                <span><strong>Urgency</strong> {c.priority.urgency}/5</span>
                <span className="text-muted">score {c.priority.score}</span>
              </div>
              <ul className="priority-reasons">
                {c.priority.reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
            </Panel>
          )}

          <Panel icon={Icon.refresh} tone="brand" title="Resolution loop" bodyClass="panel-body">
            <ol className="loop">
              {loopEvents(c).map((ev, i) => (
                <li key={i} className={`loop-item loop-${ev.kind}`}>
                  <div className="loop-head">
                    <AgentChip agent={ev.agent} />
                    <span className="loop-when">{when(ev.at)}</span>
                  </div>
                  {ev.kind === 'plan' && (
                    <div>
                      <strong>{ev.p.action.replace('_', '-')} → {ev.p.toRole}</strong>: {ev.p.ask}
                      {ev.p.revisedBecause && <div className="loop-why">Revised because: {ev.p.revisedBecause}</div>}
                    </div>
                  )}
                  {ev.kind === 'draft' && (
                    ev.d.status === 'pending'
                      ? <DraftCard draft={ev.d} onDone={reload} />
                      : <div>Drafted {ev.d.purpose.replace('_', '-')} to {ev.d.to} · <span className={`badge tone-${ev.d.status === 'sent' ? 'good' : 'neutral'}`}>{ev.d.status}{ev.d.decidedBy ? ` by ${ev.d.decidedBy}` : ''}</span></div>
                  )}
                  {ev.kind === 'sent' && <div>{Icon.send} Sent “{ev.e.subject}”</div>}
                  {ev.kind === 'reply' && (
                    <div>
                      {Icon.inbox} Reply from <strong>{ev.e.from}</strong> <ReplyType type={ev.e.classification} />
                      <div className="loop-why">{ev.e.meaning}</div>
                    </div>
                  )}
                  {ev.kind === 'check' && (
                    <div>
                      <strong>{ev.v.mode === 'finding' ? 'Challenged the finding' : 'Checked the claimed resolution'}</strong>{' '}
                      <span className={`badge tone-${ev.v.result === 'pass' ? 'good' : ev.v.result === 'stage' ? 'info' : 'alert'}`}>{ev.v.result === 'stage' ? 'stage 1 only' : ev.v.result}</span>
                      <ul className="checks">
                        {ev.v.checks.map((k, j) => (
                          <li key={j} className={k.passed ? 'check-pass' : 'check-fail'}>
                            <span className="check-mark">{k.passed ? '✓' : '✗'}</span>
                            <span><strong>{k.name}</strong> <span className="text-muted">{k.detail}</span></span>
                          </li>
                        ))}
                      </ul>
                      {ev.v.critique && <div className="loop-why">Critic: {ev.v.critique}</div>}
                    </div>
                  )}
                </li>
              ))}
            </ol>
            {c.status === 'RESOLVED' && <p className="notice-ok">{c.closureNote}</p>}
          </Panel>
        </div>

        <div className="stack">
          <Panel icon={Icon.database} tone="good" title="Evidence" count={c.evidence.length} bodyClass="">
            <ul className="evidence-list">
              {c.evidence.map((e) => (
                <li key={e.id} id={e.id}>
                  <span className="ev-id">{e.id.split('-').pop()}</span>
                  <div>
                    <div className="ev-src"><span className="src-tag">{e.source}</span> <code>{e.recordId}</code> <AgentChip agent={e.addedBy} /></div>
                    <div className="ev-claim">{e.claim}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel icon={Icon.clock} tone="warn" title="Timers and limits" actions={<span className="badge tone-neutral">Team demo rules</span>}>
            <dl className="kv-list">
              <div><dt>Request first sent</dt><dd>{when(c.requestSentAt)}</dd></div>
              <div><dt>Next reminder</dt><dd>{OPEN.includes(c.status) ? when(c.nextReminderAt) : '—'}</dd></div>
              <div><dt>Escalation at</dt><dd>{OPEN.includes(c.status) ? when(c.escalateAt) : '—'}</dd></div>
              <div><dt>Reminders</dt><dd>{c.reminders} / 2</dd></div>
              <div><dt>Wrong documents</dt><dd>{c.wrongDocs} / 2</dd></div>
              <div><dt>Sent back by Verification</dt><dd>{c.sendBacks} / 3</dd></div>
            </dl>
          </Panel>

          <Panel icon={Icon.users} tone="neutral" title="Waiting on (history)">
            <ul className="awaiting">
              {c.awaiting.map((a, i) => (
                <li key={i} className={a.current ? 'awaiting-current' : ''}>{a.party} <span className="text-muted">from {when(a.from)}</span>{a.current && <span className="badge tone-info">current</span>}</li>
              ))}
            </ul>
          </Panel>

          <Panel icon={Icon.cpu} tone="brand" title="Agent runs" count={c.runs.length} bodyClass="">
            <ul className="runs">
              {c.runs.map((r) => (
                <li key={r.runId}>
                  <button className="run-row" onClick={() => setOpenRun(openRun === r.runId ? null : r.runId)}>
                    <span className={`badge tone-${r.status === 'completed' ? 'good' : r.status === 'running' ? 'warn' : 'alert'}`}>{r.status}</span>
                    <span className="run-trigger">{r.trigger}</span>
                    <span className="text-muted">{r.steps} steps</span>
                  </button>
                  {openRun === r.runId && <TraceView runId={r.runId} />}
                </li>
              ))}
            </ul>
          </Panel>

          <Panel icon={Icon.layers} tone="info" title="Shared state history (World Model)" count={c.activity.length} bodyClass="">
            <ol className="activity">
              {c.activity.slice().reverse().slice(0, 40).map((a) => (
                <li key={a.seq}><span className="act-seq">#{a.seq}</span> <span className="act-actor">{a.actor}</span> <span className="act-sum">{a.summary}</span></li>
              ))}
            </ol>
          </Panel>

          <button className="btn-outline" disabled={busy || running} onClick={() => act(`/cases/${c.caseId}/reinvestigate`)}>{Icon.refresh} Investigate again</button>
        </div>
      </div>
    </div>
  )
}
