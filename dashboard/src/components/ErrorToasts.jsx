// Shows background agent failures (Zetaris unreachable, model not available,
// ...) that would otherwise only appear in the backend terminal.
import { useState } from 'react'
import { useEvents } from '../api'

export default function ErrorToasts() {
  const [errors, setErrors] = useState([])
  useEvents((type, data) => {
    if (type !== 'error') return
    const id = Date.now() + Math.random()
    setErrors((e) => [...e.slice(-2), { id, ...data }])
    setTimeout(() => setErrors((e) => e.filter((x) => x.id !== id)), 20000)
  })
  if (!errors.length) return null
  return (
    <div className="notif-toasts">
      {errors.map((e) => (
        <div key={e.id} className="notif-toast notif-red" onClick={() => setErrors((x) => x.filter((y) => y.id !== e.id))}>
          <div className="notif-toast-body">
            <span className="notif-toast-title">Agent run failed · {e.label}</span>
            <span className="notif-toast-msg">{e.message}</span>
          </div>
          <button className="notif-toast-close" aria-label="Dismiss">×</button>
        </div>
      ))}
    </div>
  )
}
