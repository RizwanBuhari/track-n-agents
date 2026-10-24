import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Icon } from '../components/icons'
import { PageHeader, Panel } from '../components/ui'

const FIELDS = [
  ['awbNumber', 'AWB number'],
  ['carrier', 'Carrier'],
  ['origin', 'Origin (IATA)'],
  ['destination', 'Destination (IATA)'],
  ['flightNumber', 'Flight'],
  ['flightDate', 'Flight date (YYYY-MM-DD)'],
  ['shipper', 'Shipper'],
  ['consignee', 'Consignee'],
  ['agent', 'Agent / forwarder'],
  ['cargoDescription', 'Goods'],
  ['pieces', 'Pieces'],
  ['weightKg', 'Gross weight (kg)'],
  ['chargeableWeightKg', 'Chargeable weight (kg)'],
  ['hsCode', 'HS code'],
  ['declaredValue', 'Declared value'],
  ['currency', 'Currency'],
  ['invoiceRef', 'Invoice named on the AWB'],
]

export default function UploadPage() {
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [fields, setFields] = useState(null)
  const [error, setError] = useState('')
  const [drag, setDrag] = useState(false)
  const inputRef = useRef(null)
  const navigate = useNavigate()

  async function extract(f) {
    setFile(f)
    setError('')
    setBusy(true)
    setResult(null)
    try {
      const r = await api.upload(f)
      setResult(r)
      setFields(r.extraction.fields)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    setBusy(true)
    setError('')
    try {
      const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v))
      const saved = await api.post('/awb/confirm', {
        uploadId: result.uploadId,
        fields: { ...fields, pieces: num(fields.pieces), weightKg: num(fields.weightKg), chargeableWeightKg: num(fields.chargeableWeightKg), declaredValue: num(fields.declaredValue) },
      })
      navigate(`/shipments/${saved.awbNo}`)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  const flagged = new Set(result?.extraction.flaggedFields ?? [])

  return (
    <div className="reveal">
      <PageHeader icon={Icon.upload} tone="brand" title="Upload AWB" hint="The fields are extracted for you. Check them against the document, correct anything flagged, then confirm. Confirming starts tracking and an investigation across all sources." />

      {!result && (
        <label
          className={`dropzone${drag ? ' dropzone-active' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) extract(e.dataTransfer.files[0]) }}
        >
          <input ref={inputRef} type="file" accept="application/pdf" onChange={(e) => e.target.files[0] && extract(e.target.files[0])} />
          <span className="dropzone-icon">{busy ? <span className="spinner" /> : Icon.upload}</span>
          <p className="dropzone-title">{busy ? `Reading ${file?.name}…` : 'Drop an AWB PDF here, or click to choose'}</p>
          <p className="dropzone-hint">Text PDFs are read by Nemotron. Scanned PDFs use a vision lane if one is configured, otherwise you type the fields.</p>
        </label>
      )}

      {error && <p className="error" style={{ marginTop: 16 }}>{error}</p>}

      {result && fields && (
        <div className="extract-grid">
          <Panel icon={Icon.file} tone="brand" title={result.fileName}>
            <iframe className="pdf-frame pdf-frame-tall" title="Uploaded AWB" src={`/api/awb/uploads/${result.uploadId}/file`} />
          </Panel>
          <Panel icon={Icon.edit} tone="info" title="Check and confirm" actions={<span className="badge tone-info">{result.extraction.method}</span>}>
            {result.extraction.notes && (
              <p className="notice-warn" style={{ marginTop: 0 }}>{Icon.alert}<span>{result.extraction.notes}</span></p>
            )}
            {flagged.size > 0 && <p className="text-muted small">{flagged.size} field{flagged.size === 1 ? '' : 's'} flagged for a second look.</p>}
            <div className="form-grid">
              {FIELDS.map(([key, label]) => (
                <label key={key} className={flagged.has(key) ? 'field-flagged' : ''}>
                  <span className="field-label-row">
                    {flagged.has(key) && <span className="field-flag-icon">{Icon.alert}</span>}
                    {label}
                  </span>
                  <input value={fields[key] ?? ''} onChange={(e) => setFields({ ...fields, [key]: e.target.value })} />
                </label>
              ))}
            </div>
            <div className="row-actions" style={{ marginTop: 18 }}>
              <button className="btn-primary" onClick={confirm} disabled={busy || !fields.awbNumber}>
                {busy ? <span className="spinner spinner-light" /> : Icon.check} Confirm and start tracking
              </button>
              <button className="btn-outline" onClick={() => { setResult(null); setFields(null) }} disabled={busy}>Upload another</button>
            </div>
          </Panel>
        </div>
      )}
    </div>
  )
}
