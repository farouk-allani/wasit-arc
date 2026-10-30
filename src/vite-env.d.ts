/// <reference types="vite/client" />

// Vite static asset imports — resolved to their public URL string at build time
declare module "*.webp" { const src: string; export default src; }
declare module "*.jpg"  { const src: string; export default src; }
declare module "*.png"  { const src: string; export default src; }

// React 18 passes `fetchpriority` (lowercase) straight through to the DOM.
// camelCase `fetchPriority` is React 19+; using it on React 18 triggers a
// "React does not recognize the prop" warning at runtime.
// The JSX attribute is suppressed with @ts-expect-error at the call site.
