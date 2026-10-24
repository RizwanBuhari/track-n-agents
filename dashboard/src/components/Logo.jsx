// Placeholder Track-N mark: an N drawn as a route with a destination
// marker. Replace with the final logo file when it is ready.
export default function Logo({ size = 34 }) {
  return (
    <span className="brand-mark">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="var(--brand)" />
        <path d="M9 23V9l14 14V9" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        <circle className="brand-dot" cx="23" cy="9" r="3.2" fill="var(--accent)" />
      </svg>
      <span className="brand-word">
        Track<span>-N</span>
      </span>
    </span>
  )
}
