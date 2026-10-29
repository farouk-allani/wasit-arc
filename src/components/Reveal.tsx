/**
 * Reveal — fades and lifts children into view when they enter the viewport.
 * Disabled when prefers-reduced-motion is set.
 *
 * Props:
 *   delay  — CSS transition-delay string, e.g. "100ms" (default: "0ms")
 *   y      — lift distance in px (default: 18)
 *   className / style — forwarded to the wrapper div
 */
import { useEffect, useRef, useState } from 'react'

interface RevealProps {
  children: React.ReactNode
  delay?: string
  y?: number
  className?: string
  style?: React.CSSProperties
}

// Module-level: read once, never changes
const prefersReducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function Reveal({ children, delay = '0ms', y = 18, className, style }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(prefersReducedMotion)

  useEffect(() => {
    if (prefersReducedMotion) return
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect() } },
      { threshold: 0.08 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity:    visible ? 1 : 0,
        transform:  visible ? 'none' : `translateY(${y}px)`,
        transition: `opacity 0.55s ease ${delay}, transform 0.55s ease ${delay}`,
        willChange: 'opacity, transform',
        ...style,
      }}
    >
      {children}
    </div>
  )
}
