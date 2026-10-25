// Thin client for the Track-N backend. The demo has two logins: the case
// owner and the operations manager. The choice is kept in localStorage and
// sent as a header so the backend can apply the right approval rules.
import { useEffect, useRef, useState } from 'react'

const USER_KEY = 'trackn.user'

export function currentUserId() {
  try {
    return localStorage.getItem(USER_KEY) || 'owner'
  } catch {
    return 'owner'
  }
}

export function setCurrentUserId(id) {
  try {
    localStorage.setItem(USER_KEY, id)
  } catch {
    /* private mode: the choice just isn't remembered */
  }
}

async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-demo-user': currentUserId() },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
  return data
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body = {}) => request('POST', path, body),
  async upload(file) {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/awb/extract', { method: 'POST', body: form, headers: { 'x-demo-user': currentUserId() } })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error || 'Upload failed')
    return data
  },
}

// One shared EventSource for the whole app.
let source = null
const listeners = new Set()
function ensureSource() {
  if (source) return
  source = new EventSource('/api/events')
  for (const type of ['step', 'world', 'mail', 'clock', 'error', 'alert']) {
    source.addEventListener(type, (e) => {
      const data = JSON.parse(e.data)
      for (const fn of listeners) fn(type, data)
    })
  }
}

/** Subscribe to live backend events (agent steps, World Model events, mail, clock). */
export function useEvents(handler) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    ensureSource()
    const fn = (type, data) => ref.current(type, data)
    listeners.add(fn)
    return () => listeners.delete(fn)
  }, [])
}

/**
 * Loads data and reloads it whenever the backend reports a change
 * (debounced), so pages update live while agents work.
 */
export function useLive(load, deps = []) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const timer = useRef(null)
  const reload = useRef(() => {})
  reload.current = () =>
    load()
      .then((d) => {
        setData(d)
        setError(null)
      })
      .catch((e) => setError(e.message))
  useEffect(() => {
    reload.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEvents((type) => {
    if (type !== 'world' && type !== 'mail' && type !== 'clock') return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => reload.current(), 400)
  })
  return { data, error, reload: () => reload.current() }
}
