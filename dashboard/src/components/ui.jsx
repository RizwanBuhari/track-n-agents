// Small shared building blocks: badges, page header, panels, stat tiles.
import { Link } from 'react-router-dom'
import { AGENT, CASE_STATUS, PRIORITY_TONE, PROBLEM_LABEL, REPLY_TONE } from '../utils/format'
import { Icon } from './icons'

export function CaseStatus({ status }) {
  const s = CASE_STATUS[status] ?? { label: status, tone: 'neutral' }
  return (
    <span className={`badge tone-${s.tone}`}>
      <span className="badge-dot" />
      {s.label}
    </span>
  )
}

export function Problem({ type }) {
  return <span className="badge tone-brand">{PROBLEM_LABEL[type] ?? type}</span>
}

// Severity (S, from the case content) and urgency (U, from timers and loops); hover for the reasons.
export function Priority({ p, compact }) {
  if (!p) return null
  return (
    <span className={`badge priority-badge tone-${PRIORITY_TONE[p.level] ?? 'neutral'}`} title={p.reasons.join('\n')}>
      <span className="badge-dot" />
      {p.level}
      {!compact && <span className="priority-su">S{p.severity}·U{p.urgency}</span>}
    </span>
  )
}

export function ReplyType({ type }) {
  if (!type) return null
  return <span className={`badge tone-${REPLY_TONE[type] ?? 'neutral'}`}>{type.replace(/_/g, ' ').toLowerCase()}</span>
}

export function AgentChip({ agent }) {
  const a = AGENT[agent] ?? { label: agent, tone: 'neutral' }
  return <span className={`agent-chip tone-${a.tone}`}>{a.label}</span>
}

export function SimLabel() {
  return <span className="sim-label">Simulated</span>
}

export function PageHeader({ icon, tone = 'brand', title, hint, actions }) {
  return (
    <div className="page-header" style={{ marginBottom: 24 }}>
      <div className="page-head-left">
        <span className={`page-lead tone-${tone}`}>{icon}</span>
        <div>
          <h1 className="page-title">{title}</h1>
          {hint && <p className="page-hint">{hint}</p>}
        </div>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

export function Panel({ icon, tone = 'brand', title, count, actions, children, className = '', bodyClass = 'panel-body' }) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-header">
        {icon && <span className={`panel-lead tone-${tone}`}>{icon}</span>}
        <h2 className="panel-title">{title}</h2>
        {count !== undefined && <span className="panel-count">{count}</span>}
        {actions}
      </header>
      <div className={bodyClass}>{children}</div>
    </section>
  )
}

export function Stat({ icon, tone, value, label, hint, to }) {
  const body = (
    <>
      <div className="stat-top">
        <span className="stat-icon">{icon}</span>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </>
  )
  return to ? (
    <Link to={to} className={`stat-tile tone-${tone}`} style={{ textDecoration: 'none' }}>
      {body}
    </Link>
  ) : (
    <div className={`stat-tile tone-${tone}`}>{body}</div>
  )
}

export function Empty({ icon = Icon.check, good, children }) {
  return (
    <div className="empty-state">
      <span className={`empty-icon${good ? ' empty-icon-good' : ''}`}>{icon}</span>
      <p>{children}</p>
    </div>
  )
}

export function Evidence({ text }) {
  // Turn [TN-0001-E02] references into highlighted chips.
  const parts = String(text ?? '').split(/(\[TN-\d{4}-E\d{2}\])/g)
  return parts.map((p, i) =>
    /^\[TN-\d{4}-E\d{2}\]$/.test(p) ? (
      <a key={i} href={`#${p.slice(1, -1)}`} className="ev-ref">
        {p.slice(1, -1).split('-').pop()}
      </a>
    ) : (
      <span key={i}>{p}</span>
    ),
  )
}
