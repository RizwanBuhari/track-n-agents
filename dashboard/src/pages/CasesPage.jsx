import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, useLive } from '../api'
import { Icon } from '../components/icons'
import PageLoader from '../components/PageLoader'
import { CaseStatus, PageHeader, Problem } from '../components/ui'
import { OPEN, when } from '../utils/format'

export default function CasesPage() {
  const { data } = useLive(() => api.get('/cases'))
  const [filter, setFilter] = useState('open')
  const navigate = useNavigate()
  if (!data) return <PageLoader />
  const rows = data.filter((c) => (filter === 'open' ? OPEN.includes(c.status) : filter === 'closed' ? !OPEN.includes(c.status) : true))

  return (
    <div className="reveal">
      <PageHeader icon={Icon.alert} tone="info" title="Cases" hint="One case per shipment problem. Case status is separate from the shipment's tracking status." />
      <div className="filter-bar">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="all">All</option>
        </select>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
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
