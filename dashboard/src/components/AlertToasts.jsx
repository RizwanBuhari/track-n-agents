// Live alert when a case rises to Critical priority. Stays until dismissed:
// the operations manager has a notice to approve in Approvals.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { currentUserId, useEvents } from '../api'

export default function AlertToasts() {
  const [alerts, setAlerts] = useState([])
  useEvents((type, data) => {
    if (type !== 'alert') return
    setAlerts((a) => [...a.filter((x) => x.caseId !== data.caseId).slice(-2), data])
  })
  if (!alerts.length) return null
  const dismiss = (caseId) => setAlerts((a) => a.filter((x) => x.caseId !== caseId))
  return (
    <div className="notif-toasts alert-toasts">
      {alerts.map((a) => (
        <div key={a.caseId} className="notif-toast notif-red">
          <div className="notif-toast-body">
            <span className="notif-toast-title">Critical priority · {a.caseId}</span>
            <span className="notif-toast-msg">
              <Link to={`/cases/${a.caseId}`} className="table-link" onClick={() => dismiss(a.caseId)}>AWB {a.awbNo} · {a.title}</Link>
            </span>
            <span className="notif-toast-msg text-muted">{a.reasons?.[0]}</span>
            <span className="notif-toast-msg text-muted">
              Timers halved.{' '}
              {currentUserId() === 'manager'
                ? <Link to="/approvals" className="table-link" onClick={() => dismiss(a.caseId)}>Approve the notice in Approvals</Link>
                : 'A notice is waiting for the operations manager.'}
            </span>
          </div>
          <button className="notif-toast-close" aria-label="Dismiss" onClick={() => dismiss(a.caseId)}>×</button>
        </div>
      ))}
    </div>
  )
}
