import { useEffect, useRef, useState } from "react";
import { createGlobe } from "./createGlobe";

/** Joins truthy class-name strings — replaces the cn() helper from @/lib/utils. */
function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

/** Mounts the three.js globe; fades it in on its first frame and reports a WebGL failure. */
export default function GlobeCanvas({
  className,
  onFail,
}: {
  className?: string;
  onFail: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    try {
      const globe = createGlobe(element, {
        reducedMotion,
        onFirstFrame: () => setShown(true),
        onError: onFail,
      });
      return () => globe.destroy();
    } catch (error) {
      console.warn("Globe disabled:", error);
      onFail();
    }
  }, [onFail]);

  return (
    <div
      ref={container}
      aria-hidden
      className={cx(
        "transition-[opacity,scale] duration-[1600ms]",
        shown ? "scale-100 opacity-100" : "scale-95 opacity-0",
        className,
      )}
      // ease-out-quint is not a stock Tailwind easing; apply it via inline style
      style={{ transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)" }}
    />
  );
}
