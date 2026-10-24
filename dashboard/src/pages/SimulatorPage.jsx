// Demo controls for the SIMULATED world: counterparties' replies, the
// demo clock and the shared mailbox. Everything here is labelled simulated.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, useLive } from '../api'
import { Icon } from '../components/icons'
import PageLoader from '../components/PageLoader'
import { CaseStatus, Empty, PageHeader, Panel, Problem, SimLabel } from '../components/ui'
import { OPEN, when } from '../utils/format'

function CaseScripts({ c }) {
  const [scripts, setScripts] = useState(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  useEffect(() => {
    api.get(`/sim/cases/${c.caseId}/scripts`).then(setScripts)
  }, [c.caseId])
  async function deliver(id) {
    setBusy(id)
    setMsg('')
    try {
      const m = await api.post(`/sim/cases/${c.caseId}/deliver`, { scriptId: id })
      setMsg(`Delivered ${m.message_id} from ${m.from_addr}. The agents are reading it.`)
    } catch (e) {
      setMsg(e.message)
    } finally {
      setBusy('')
    }
  }
  return (
    <div className="sim-case">
      <div className="sim-case-head">
        <Link to={`/cases/${c.caseId}`} className="table-link">{c.caseId}</Link> AWB {c.awbNo} <Problem type={c.problemType} /> <CaseStatus status={c.status} />
      </div>
      {!scripts ? <span className="spinner" /> : (
        <div className="sim-scripts">
          {scripts.map((s) => (
            <button key={s.id} className="sim-script" disabled={!!busy} onClick={() => deliver(s.id)}>
              <strong>{busy === s.id ? <span className="spinner" /> : Icon.inbox} {s.label}</strong>
              <span>Expected: {s.expect}</span>
            </button>
          ))}
        </div>
      )}
      {msg && <p className="text-muted small">{msg}</p>}
    </div>
  )
}

export default function SimulatorPage() {
  const { data, reload } = useLive(async () => {
    const [cases, clock, mailbox] = await Promise.all([api.get('/cases'), api.get('/sim/clock'), api.get('/mailbox')])
    return { cases, clock, mailbox }
  })
  const [busy, setBusy] = useState(false)
  if (!data) return <PageLoader />
  const open = data.cases.filter((c) => OPEN.includes(c.status) && c.status !== 'READY_TO_CLOSE')
  const lastInbound = data.mailbox.find((m) => m.direction === 'inbound' && m.case_id)

  async function advance(hours) {
    setBusy(true)
    await api.post('/sim/clock/advance', { hours })
    setBusy(false)
    reload()
  }

  return (
    <div className="reveal">
      <PageHeader icon={Icon.play} tone="warn" title="Simulator" hint="Plays the outside world for the demo: shippers, brokers, carriers and the warehouse reply here. Replies also update the simulated carrier and customs systems the way the real world would; Verification checks those systems, not the email." actions={<SimLabel />} />

      <div className="panel-row" style={{ marginBottom: 20 }}>
        <Panel icon={Icon.clock} tone="warn" title="Demo clock" actions={<span className="badge tone-neutral">Team demo rules</span>}>
          <p>Now: <strong>{when(data.clock.now)}</strong> {data.clock.offsetHours > 0 && <span className="text-muted">(+{data.clock.offsetHours} h ahead of real time)</span>}</p>
          <p className="text-muted small">Advancing the clock fires reminder and escalation timers for cases waiting on a reply.</p>
          <div className="row-actions">
            {[1, 2, 4, 6].map((h) => <button key={h} className="btn-outline" disabled={busy} onClick={() => advance(h)}>+{h} h</button>)}
          </div>
        </Panel>
        <Panel icon={Icon.refresh} tone="neutral" title="Duplicate test">
          <p className="text-muted small">Re-send the latest reply with a new message ID. Track-N should link it to the earlier evidence and do nothing new.</p>
          <button className="btn-outline" disabled={!lastInbound} onClick={() => api.post('/sim/redeliver', { messageId: lastInbound.message_id, newId: true }).then(reload)}>
            Re-send {lastInbound ? lastInbound.message_id : 'latest reply'}
          </button>
        </Panel>
      </div>

      <Panel icon={Icon.inbox} tone="brand" title="Deliver a reply" count={open.length}>
        {open.length ? <div className="stack">{open.map((c) => <CaseScripts key={c.caseId} c={c} />)}</div> : <Empty>No open cases waiting on a reply.</Empty>}
      </Panel>

      <div style={{ height: 20 }} />
      <Panel icon={Icon.mail} tone="neutral" title="Shared mailbox" actions={<SimLabel />} bodyClass="">
        <ul className="mini-list">
          {data.mailbox.slice(0, 30).map((m) => (
            <li key={m.message_id} className="mini-row">
              <span className={`mini-icon tone-${m.direction === 'inbound' ? 'info' : 'good'}`}>{m.direction === 'inbound' ? Icon.inbox : Icon.send}</span>
              <span className="mini-main">
                <span className="mini-title">{m.subject}</span>
                <span className="mini-sub">{m.direction === 'inbound' ? `from ${m.from_addr}` : `to ${m.to_addr}`} · {m.message_id}{m.attachments ? ` · ${m.attachments}` : ''}</span>
              </span>
              <span className="mini-meta">{when(m.sent_at)}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}
