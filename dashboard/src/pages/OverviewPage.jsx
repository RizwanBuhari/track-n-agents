import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, useEvents, useLive } from '../api'
import { Icon } from '../components/icons'
import PageLoader from '../components/PageLoader'
import { AgentChip, CaseStatus, Empty, Panel, Problem, Stat } from '../components/ui'
import { OPEN, ago } from '../utils/format'

export default function OverviewPage() {
  const { data } = useLive(async () => {
    const [shipments, cases, approvals, runs] = await Promise.all([api.get('/shipments'), api.get('/cases'), api.get('/approvals'), api.get('/runs')])
    return { shipments, cases, approvals, runs }
  })
  const [steps, setSteps] = useState([])
  useEvents((type, step) => {
    if (type === 'step' && step.kind !== 'note') setSteps((s) => [{ ...step, key: `${step.runId}-${step.n}-${s.length}` }, ...s].slice(0, 14))
  })
  if (!data) return <PageLoader />

  const open = data.cases.filter((c) => OPEN.includes(c.status))
  const resolved = data.cases.filter((c) => c.status === 'RESOLVED')
  const ready = data.approvals.closures
  const drafts = data.approvals.drafts
  const attention = data.cases.filter((c) => ['ESCALATED', 'STALLED'].includes(c.status) || c.flags?.length)
  const clean = data.shipments.filter((s) => s.cases.length === 0).length

  return (
    <div className="reveal">
      <section className="hero-card">
        <div>
          <p className="hero-eyebrow">Shipment exception resolution</p>
          <h1 className="hero-title">
            {open.length ? `${open.length} open case${open.length === 1 ? '' : 's'}, ${drafts.length + ready.length} waiting for you` : 'No open cases'}
          </h1>
          <p className="hero-sub">Four agents connect AWBs, invoices, documents, carrier tracking, customs and email through Zetaris, and verify every fix against the records before anything closes.</p>
          <div className="hero-chips">
            <span className="hero-chip">{Icon.package} {data.shipments.length} shipments tracked</span>
            <span className="hero-chip">{Icon.check} {clean} clean, no case needed</span>
            {drafts.length > 0 && <span className="hero-chip hero-chip-warn">{Icon.mail} {drafts.length} email{drafts.length === 1 ? '' : 's'} to approve</span>}
            {attention.length > 0 && <span className="hero-chip hero-chip-alert">{Icon.alert} {attention.length} need a person</span>}
          </div>
        </div>
        <div className="hero-side">
          <div className="hero-big">{resolved.length}</div>
          <p className="hero-ring-cap">verified & resolved</p>
        </div>
      </section>

      <div className="stat-grid">
        <Stat icon={Icon.alert} tone="info" value={open.length} label="Open cases" to="/cases" />
        <Stat icon={Icon.mail} tone="warn" value={drafts.length} label="Emails awaiting approval" to="/approvals" />
        <Stat icon={Icon.shield} tone="good" value={ready.length} label="Verified, ready to close" to="/approvals" />
        <Stat icon={Icon.zap} tone="alert" value={attention.length} label="Escalated or flagged" to="/cases" />
        <Stat icon={Icon.check} tone="good" value={resolved.length} label="Resolved" hint="closed by a person after verification" />
      </div>

      <div className="panel-row">
        <Panel icon={Icon.alert} tone="info" title="Open cases" count={open.length} bodyClass="">
          {open.length === 0 ? (
            <Empty good>Nothing open. Upload an AWB to start tracking a shipment.</Empty>
          ) : (
            <ul className="mini-list">
              {open.map((c) => (
                <li key={c.caseId}>
                  <Link to={`/cases/${c.caseId}`} className="mini-row">
                    <span className="mini-icon tone-info">{Icon.alert}</span>
                    <span className="mini-main">
                      <span className="mini-title">{c.caseId} · AWB {c.awbNo}</span>
                      <span className="mini-sub"><Problem type={c.problemType} /> {["WAITING_REPLY", "AWAITING_ARRIVAL", "WAITING_ON_ISSUER"].includes(c.status) && `waiting on ${c.awaitingRole}`}</span>
                    </span>
                    <span className="mini-meta"><CaseStatus status={c.status} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel icon={Icon.cpu} tone="warn" title="Live agent activity" bodyClass="">
          {steps.length === 0 ? (
            <ul className="mini-list">
              {data.runs.slice(0, 8).map((r) => (
                <li key={r.runId}>
                  <Link to={r.caseId ? `/cases/${r.caseId}` : '/cases'} className="mini-row">
                    <span className={`mini-icon tone-${r.status === 'completed' ? 'good' : r.status === 'running' ? 'warn' : 'alert'}`}>{Icon.cpu}</span>
                    <span className="mini-main">
                      <span className="mini-title">{r.trigger}</span>
                      <span className="mini-sub">{r.steps} steps · {r.status}{r.caseId ? ` · ${r.caseId}` : ''}</span>
                    </span>
                    <span className="mini-meta">{ago(r.startedAt)}</span>
                  </Link>
                </li>
              ))}
              {data.runs.length === 0 && <Empty>No agent runs yet.</Empty>}
            </ul>
          ) : (
            <ul className="feed">
              {steps.map((s) => (
                <li key={s.key} className={`feed-item feed-${s.kind}`}>
                  <AgentChip agent={s.agent} />
                  <span className="feed-text">{s.summary}</span>
                  {s.ms ? <span className="feed-ms">{(s.ms / 1000).toFixed(1)}s</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}
