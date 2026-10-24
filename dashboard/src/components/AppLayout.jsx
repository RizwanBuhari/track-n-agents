// The shell around every page: a thin utility strip (live agent activity,
// demo clock, who is signed in) plus the nav bar, then the active page.
import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { api, currentUserId, setCurrentUserId, useEvents, useLive } from '../api'
import { AGENT, when } from '../utils/format'
import ChatPanel from './ChatPanel'
import ErrorToasts from './ErrorToasts'
import { Icon } from './icons'
import Logo from './Logo'

const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: Icon.chart, end: true },
  { to: '/shipments', label: 'Shipments', icon: Icon.package },
  { to: '/upload', label: 'Upload AWB', icon: Icon.upload },
  { to: '/cases', label: 'Cases', icon: Icon.alert },
  { to: '/approvals', label: 'Approvals', icon: Icon.shield, badge: true },
]

// Small health indicator; the full integration details live at /system.
function SystemStatus() {
  const [ok, setOk] = useState(null)
  useEffect(() => {
    const check = () =>
      api
        .get('/integrations')
        .then((d) => setOk(d.zetaris.ok && d.meterless.ok))
        .catch(() => setOk(false))
    check()
    const t = setInterval(check, 60000)
    return () => clearInterval(t)
  }, [])
  return (
    <NavLink to="/system" className={`sys-status sys-${ok === null ? 'wait' : ok ? 'ok' : 'down'}`} title="Integration status">
      <span className="sys-dot" />
      {ok === null ? 'Checking systems' : ok ? 'All systems connected' : 'A system is unavailable'}
    </NavLink>
  )
}

function LiveTicker() {
  const [step, setStep] = useState(null)
  useEvents((type, data) => {
    if (type === 'step' && data.kind !== 'note') setStep({ ...data, seen: Date.now() })
  })
  const active = step && Date.now() - step.seen < 15000
  return (
    <span className={`live-ticker${active ? ' live-ticker-on' : ''}`} title={step?.summary}>
      <span className="live-dot" />
      {step ? (
        <>
          <strong>{AGENT[step.agent]?.label ?? step.agent}</strong>
          <span className="live-text">{step.summary}</span>
        </>
      ) : (
        <span className="live-text">Agents idle</span>
      )}
    </span>
  )
}

export default function AppLayout() {
  const [user, setUser] = useState(currentUserId())
  const { data: approvals } = useLive(() => api.get('/approvals'))
  const { data: clock } = useLive(() => api.get('/sim/clock'))
  const pending = approvals ? approvals.drafts.length + approvals.closures.length : 0

  function switchUser(id) {
    setCurrentUserId(id)
    setUser(id)
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="topstrip">
          <div className="topstrip-inner">
            <LiveTicker />
            <div className="topstrip-right">
              {/* The simulated outside world for demos; not part of the operations product. */}
              <NavLink to="/simulator" className="demo-controls" title="Simulated replies and demo clock">
                {Icon.play} Demo controls
              </NavLink>
              <SystemStatus />
              {clock && (
                <span className="topstrip-clock" title="Demo clock (Team Demo Rules)">
                  {Icon.clock} {when(clock.now)}
                  {clock.offsetHours > 0 && <em>+{clock.offsetHours}h</em>}
                </span>
              )}
              <select className="user-switch" value={user} onChange={(e) => switchUser(e.target.value)} aria-label="Signed in as">
                <option value="owner">Maya Haddad · Case owner</option>
                <option value="manager">Daniel Okafor · Ops manager</option>
              </select>
            </div>
          </div>
        </div>

        <div className="topbar">
          <div className="topbar-inner">
            <NavLink to="/" className="topbar-brand" end>
              <Logo />
            </NavLink>
            <nav className="topnav">
              {NAV_ITEMS.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end}>
                  {item.icon}
                  <span>{item.label}</span>
                  {item.badge && pending > 0 && <b className="nav-count">{pending}</b>}
                </NavLink>
              ))}
            </nav>
          </div>
        </div>
      </header>

      <main className="content" key={user}>
        <Outlet />
      </main>

      <ChatPanel />
      <ErrorToasts />
    </div>
  )
}
