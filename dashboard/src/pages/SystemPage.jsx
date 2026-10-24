// Proof of the sponsor integrations: live Zetaris sources, Nightshift and
// Nemotron lanes, and the World Model engine with its conformance suite.
import { useState } from 'react'
import { api, useLive } from '../api'
import { Icon } from '../components/icons'
import PageLoader from '../components/PageLoader'
import { PageHeader, Panel } from '../components/ui'
import { when } from '../utils/format'

const Ok = ({ ok }) => <span className={`badge tone-${ok ? 'good' : 'alert'}`}><span className="badge-dot" />{ok ? 'connected' : 'unavailable'}</span>

export default function SystemPage() {
  const { data, reload } = useLive(() => api.get('/integrations'))
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState('')
  if (!data) return <PageLoader />
  const z = data.zetaris
  const m = data.meterless
  const w = data.worldModel

  async function conformance() {
    setRunning(true)
    const r = await api.post('/integrations/conformance')
    setOutput(r.output)
    setRunning(false)
    reload()
  }

  return (
    <div className="reveal">
      <PageHeader icon={Icon.layers} tone="brand" title="System" hint="Live status of the data layer (Zetaris), the shared state engine (Meterless World Model) and the AI provider (Meterless Nightshift with NVIDIA Nemotron)." />
      <div className="panel-row">
        <Panel icon={Icon.database} tone="info" title="Zetaris: four sources, one SQL access point" actions={<Ok ok={z.ok} />}>
          {z.ok ? (
            <>
              <p className="text-muted small">One live query across Postgres, MySQL and two REST APIs took {z.ms} ms.</p>
              <dl className="kv-list">
                {z.sources.map((s) => <div key={s.source}><dt><code>{s.source}</code></dt><dd>{s.records} records</dd></div>)}
              </dl>
            </>
          ) : <p className="error">{z.error}</p>}
        </Panel>

        <Panel icon={Icon.cpu} tone="warn" title="Meterless Nightshift + NVIDIA Nemotron" actions={<Ok ok={m.ok} />}>
          {m.ok ? (
            <dl className="kv-list">
              <div><dt>Runtime</dt><dd><code>{m.url}</code></dd></div>
              <div><dt>Deep lane (investigation, critic)</dt><dd><code>{m.deepModel}</code></dd></div>
              <div><dt>Fast lane (planning, email, extraction, chat)</dt><dd><code>{m.fastModel}</code></dd></div>
              <div><dt>Nemotron models available</dt><dd>{m.nemotronAvailable.length}</dd></div>
            </dl>
          ) : <p className="error">{m.error}</p>}
        </Panel>
      </div>

      <div style={{ height: 20 }} />
      <Panel icon={Icon.layers} tone="good" title="Meterless World Model: shared case state" actions={
        <button className="btn-sm btn-sm-primary" disabled={running} onClick={conformance}>{running ? <span className="spinner spinner-light" /> : Icon.play} Run conformance suite</button>
      }>
        <div className="panel-row">
          <dl className="kv-list">
            <div><dt>Engine</dt><dd>{w.engine}</dd></div>
            <div><dt>Events in the log</dt><dd>{w.events}</dd></div>
            <div><dt>Entities</dt><dd>{w.entities}</dd></div>
            <div><dt>Audit entries</dt><dd>{w.auditEntries}</dd></div>
            {w.byType.map(([t, n]) => <div key={t}><dt>{t}</dt><dd>{n}</dd></div>)}
          </dl>
          <div>
            <h3 className="small-head">Latest events</h3>
            <ol className="activity">
              {w.lastEvents.map((e) => <li key={e.seq}><span className="act-seq">#{e.seq}</span> <span className="act-actor">{e.by ?? '—'}</span> <span className="act-sum">{e.kind} · {when(e.at)}</span></li>)}
            </ol>
          </div>
        </div>
        {(output || data.conformance) && <pre className="conformance">{output || data.conformance.output}</pre>}
      </Panel>
    </div>
  )
}
