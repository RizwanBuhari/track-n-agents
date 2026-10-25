import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, useLive } from '../api'
import { Icon } from '../components/icons'
import PageLoader from '../components/PageLoader'
import { CaseStatus, PageHeader, Priority, Problem } from '../components/ui'
import { OPEN, when } from '../utils/format'

export default function CasesPage() {
  const { data } = useLive(() => api.get('/cases'))
  const [filter, setFilter] = useState('open')
  const [sort, setSort] = useState('priority')
  const navigate = useNavigate()
  if (!data) return <PageLoader />
  // The server already orders open cases by priority; "newest" re-sorts by opening time.
  const rows = data
    .filter((c) => (filter === 'open' ? OPEN.includes(c.status) : filter === 'closed' ? !OPEN.includes(c.status) : true))
    .slice()
    .sort((a, b) => (sort === 'newest' ? String(b.openedAt).localeCompare(String(a.openedAt)) : 0))
  const rank = new Map(data.filter((c) => OPEN.includes(c.status)).map((c, i) => [c.caseId, i + 1]))

  return (
    <div className="reveal">
      <PageHeader icon={Icon.alert} tone="info" title="Cases" hint="One case per shipment problem, ranked by priority: severity from the case content, urgency from timers and loops. Hover a priority to see why." />
      <div className="filter-bar">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="all">All</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="priority">Sort by priority</option>
          <option value="newest">Sort by newest</option>
        </select>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Priority</th>
              <th>Case</th>
              <th>AWB</th>
              <th>Problem</th>
              <th>Status</th>
              <th>Waiting on</th>
              <th>Loops</th>
              <th>Owner</th>
              <th>Opened</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.caseId} onClick={() => navigate(`/cases/${c.caseId}`)}>
                <td className="priority-rank">{rank.get(c.caseId) ?? '—'}</td>
                <td>{OPEN.includes(c.status) ? <Priority p={c.priority} /> : <span className="text-muted">—</span>}</td>
                <td><span className="table-link">{c.caseId}</span>{c.flags?.length > 0 && <span className="flag-dot" title={c.flags.join('\n')}>!</span>}</td>
                <td>{c.awbNo}</td>
                <td><Problem type={c.problemType} /></td>
                <td><CaseStatus status={c.status} /></td>
                <td>{OPEN.includes(c.status) ? c.awaitingRole || '—' : '—'}</td>
                <td className="text-muted">{c.sendBacks} sent back · {c.reminders} reminders · {c.wrongDocs} wrong docs</td>
                <td>{c.owner}</td>
                <td>{when(c.openedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="filter-empty">No cases here.</p>}
      </div>
    </div>
  )
}
