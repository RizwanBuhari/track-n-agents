import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, useLive } from '../api'
import { Icon } from '../components/icons'
import PageLoader from '../components/PageLoader'
import { CaseStatus, PageHeader, Problem } from '../components/ui'
import { kg, when } from '../utils/format'

export default function ShipmentsPage() {
  const { data } = useLive(() => api.get('/shipments'))
  const [q, setQ] = useState('')
  const navigate = useNavigate()
  if (!data) return <PageLoader />
  const rows = data.filter((s) => `${s.awb_no} ${s.shipper} ${s.consignee} ${s.origin} ${s.destination}`.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="reveal">
      <PageHeader icon={Icon.package} tone="info" title="Shipments" hint="Every confirmed AWB. Uploading starts tracking; a case opens only when the sources show a real problem." />
      <div className="filter-bar">
        <label className="search-field">
          {Icon.search}
          <input placeholder="Search AWB, company or airport" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>AWB</th>
              <th>Route</th>
              <th>Shipper → Consignee</th>
              <th>Goods</th>
              <th>Weight</th>
              <th>Case</th>
              <th>Confirmed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const c = s.cases[s.cases.length - 1]
              return (
                <tr key={s.awb_no} onClick={() => navigate(`/shipments/${s.awb_no}`)}>
                  <td><span className="table-link">{s.awb_no}</span></td>
                  <td>{s.origin} → {s.destination} <span className="text-muted">{s.flight_no}</span></td>
                  <td className="cell-wrap">{s.shipper}<br /><span className="text-muted">{s.consignee}</span></td>
                  <td className="cell-wrap">{s.goods}</td>
                  <td>{kg(s.gross_weight_kg)} · {s.pieces} pcs</td>
                  <td>{c ? <span className="cell-stack"><Problem type={c.problemType} /><CaseStatus status={c.status} /></span> : <span className="badge tone-good"><span className="badge-dot" />Clean</span>}</td>
                  <td>{when(s.confirmed_at)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="filter-empty">No shipments yet. Upload an AWB to start.</p>}
      </div>
    </div>
  )
}
