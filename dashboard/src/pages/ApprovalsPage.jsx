import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, useLive } from '../api'
import DraftCard from '../components/DraftCard'
import { Icon } from '../components/icons'
import PageLoader from '../components/PageLoader'
import { Empty, PageHeader, Panel, Priority, Problem } from '../components/ui'

function ClosureRow({ c, onDone }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <div className="closure-row">
      <div>
        <Link to={`/cases/${c.caseId}`} className="table-link">{c.caseId}</Link> · AWB {c.awbNo} <Priority p={c.priority} compact /> <Problem type={c.problemType} />
        <div className="text-muted">{c.summary}</div>
        {error && <p className="error">{error}</p>}
      </div>
      <div className="row-actions">
        <Link to={`/cases/${c.caseId}`} className="btn-outline">Review checks</Link>
        <button
          className="btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await api.post(`/cases/${c.caseId}/close`, {})
              onDone()
            } catch (e) {
              setError(e.message)
            } finally {
              setBusy(false)
            }
          }}
        >
          {Icon.check} Approve closure
        </button>
      </div>
    </div>
  )
}

export default function ApprovalsPage() {
  const { data, reload } = useLive(() => api.get('/approvals'))
  if (!data) return <PageLoader />
  return (
    <div className="reveal">
      <PageHeader icon={Icon.shield} tone="good" title="Approvals" hint="Nothing leaves Track-N and no case closes without a person. Approve, edit or send back each email; approve closures only after Verification has passed." />
      <div className="stack">
        <Panel icon={Icon.shield} tone="good" title="Ready to close" count={data.closures.length}>
          {data.closures.length ? data.closures.map((c) => <ClosureRow key={c.caseId} c={c} onDone={reload} />) : <Empty good>No verified cases waiting for closure.</Empty>}
        </Panel>
        <Panel icon={Icon.mail} tone="warn" title="Emails waiting for approval" count={data.drafts.length}>
          {data.drafts.length ? <div className="stack">{data.drafts.map((d) => <DraftCard key={d.id} draft={d} showCase onDone={reload} />)}</div> : <Empty good>No drafts waiting.</Empty>}
        </Panel>
      </div>
    </div>
  )
}
