/** Wasit logomark — inline SVG so it inherits colour context. */
export function WasitLogo({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="wl-steel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#eef2f6" />
          <stop offset="1" stopColor="#8d98a8" />
        </linearGradient>
        <linearGradient id="wl-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f3dcb4" />
          <stop offset="1" stopColor="#b8895a" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="#0b1624" />
      <g transform="translate(32 32) scale(0.82) translate(-32 -32)">
        <g fill="none" strokeWidth="7" strokeLinejoin="miter">
          <path d="M24 11 L9 32 L24 53" stroke="url(#wl-steel)" />
          <path d="M40 11 L55 32 L40 53" stroke="url(#wl-gold)" />
        </g>
        <path d="M32 21 L43 32 L32 43 L21 32Z" fill="#f6efe2" />
      </g>
    </svg>
  )
}
