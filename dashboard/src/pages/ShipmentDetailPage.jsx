import { Link, useParams } from 'react-router-dom'
import { api, useLive } from '../api'
import { Icon } from '../components/icons'
import PageLoader from '../components/PageLoader'
import { CaseStatus, Panel, Problem, SimLabel } from '../components/ui'
import { kg, when } from '../utils/format'

const SRC = ({ name }) => <span className="src-tag">{name}</span>

export default function ShipmentDetailPage() {
  const { awb } = useParams()
  const { data, error } = useLive(() => api.get(`/shipments/${awb}`), [awb])
  if (error) return <p className="error">{error}</p>
  if (!data) return <PageLoader />
  const s = data.shipment
  const uploadId = String(s.source_file ?? '').split('|')[0].replace('.pdf', '')
  const hasPdf = /^[0-9a-f-]{36}$/.test(uploadId)

  return (
    <div className="reveal">
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div className="page-head-left">
          <span className="page-lead tone-info">{Icon.plane}</span>
          <div>
            <h1 className="page-title">AWB {s.awb_no}</h1>
            <p className="page-hint">{s.carrier} · {s.origin} → {s.destination} · flight {s.flight_no} on {String(s.flight_date ?? '').slice(0, 10)}</p>
          </div>
        </div>
        <div className="page-actions">
          <button className="btn-outline" onClick={() => api.post(`/shipments/${s.awb_no}/investigate`)}>{Icon.refresh} Re-investigate</button>
        </div>
      </div>

      {data.cases.length > 0 && (
        <div className="case-strip">
          {data.cases.map((c) => (
            <Link key={c.caseId} to={`/cases/${c.caseId}`} className="case-strip-item">
              <strong>{c.caseId}</strong> <Problem type={c.problemType} /> <CaseStatus status={c.status} />
              <span className="text-muted">{c.summary}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="detail-grid">
        <div className="stack">
          <Panel icon={Icon.file} tone="brand" title="Confirmed AWB fields" actions={<SRC name="trackn_ops.shipments" />}>
            <dl className="kv-list kv-2">
              <div><dt>Shipper</dt><dd>{s.shipper}</dd></div>
              <div><dt>Consignee</dt><dd>{s.consignee}</dd></div>
              <div><dt>Agent</dt><dd>{s.agent}</dd></div>
              <div><dt>Goods</dt><dd>{s.goods}</dd></div>
              <div><dt>Pieces / gross</dt><dd>{s.pieces} · {kg(s.gross_weight_kg)}</dd></div>
              <div><dt>Chargeable</dt><dd>{kg(s.chargeable_weight_kg)}</dd></div>
              <div><dt>HS code</dt><dd>{s.hs_code || '—'}</dd></div>
              <div><dt>Declared value</dt><dd>{s.declared_value ? `${Number(s.declared_value).toLocaleString()} ${s.currency}` : '—'}</dd></div>
              <div><dt>Invoice named on AWB</dt><dd>{s.invoice_ref || '—'}</dd></div>
              <div><dt>Confirmed by</dt><dd>{s.owner} · {when(s.confirmed_at)}</dd></div>
            </dl>
          </Panel>

          <Panel icon={Icon.database} tone="info" title="Related records from every source" bodyClass="panel-body records">
            <h3>Invoices <SRC name="trackn_finance.invoices (MySQL)" /></h3>
            {data.invoices.length ? data.invoices.map((i) => (
              <div key={`${i.invoice_no}-${i.version}`} className="record-row">
                <strong>{i.invoice_no} v{i.version}</strong> quotes <code>{i.shipment_ref_as_written}</code> for {i.consignee_as_written} · HS {i.hs_code} · {kg(i.gross_weight_kg)}
              </div>
            )) : <p className="text-muted">No invoice quotes this AWB.</p>}
            <h3>Documents <SRC name="trackn_ops.documents (Postgres)" /></h3>
            {data.documents.length ? data.documents.map((d) => (
              <div key={d.doc_id} className="record-row">
                <strong>{d.doc_type.replace(/_/g, ' ').toLowerCase()}</strong> {d.ref_no} v{d.version} · AWB written <code>{d.awb_as_written}</code> · {d.pieces ?? '—'} pcs · {kg(d.gross_weight_kg)}
              </div>
            )) : <p className="text-muted">No documents.</p>}
            <h3>Customs <SRC name="trackn_customs.customs_entries (REST)" /> <SimLabel /></h3>
            {data.customs.length ? data.customs.map((c) => (
              <div key={c.entry_no} className="record-row">
                <strong>{c.entry_no}</strong> {c.status} · {when(c.status_at)} · missing: {c.documents_missing} {c.release_ref && <>· release <code>{c.release_ref}</code></>}
              </div>
            )) : <p className="text-muted">No customs entry yet.</p>}
          </Panel>
        </div>

        <div className="stack">
          <Panel icon={Icon.route} tone="warn" title="Carrier tracking" actions={<><SRC name="trackn_carrier (REST)" /><SimLabel /></>}>
            <ol className="timeline">
              {[...data.tracking].reverse().map((t, i) => (
                <li key={t.event_id} className={`timeline-item ${i === 0 ? (['HLD', 'OFLD', 'DIS'].includes(t.code) ? 'timeline-item-alert' : 'timeline-item-current') : 'timeline-item-done'}`}>
                  <span className="timeline-dot" />
                  <div className="timeline-title">{t.code} · {t.description}</div>
                  <div className="timeline-meta">{t.location} · {String(t.event_time).replace('T', ' ').slice(0, 16)}</div>
                </li>
              ))}
            </ol>
          </Panel>
          <Panel icon={Icon.users} tone="neutral" title="Parties" actions={<SRC name="trackn_ops.parties" />}>
            <dl className="kv-list">
              {data.parties.map((p) => <div key={p.role}><dt>{p.role}</dt><dd>{p.name}<br /><span className="text-muted">{p.email}</span></dd></div>)}
            </dl>
          </Panel>
          {hasPdf && (
            <Panel icon={Icon.file} tone="brand" title="Original document">
              <iframe className="pdf-frame" title="AWB" src={`/api/awb/uploads/${uploadId}/file`} />
            </Panel>
          )}
        </div>
      </div>
    </div>
  )
}
