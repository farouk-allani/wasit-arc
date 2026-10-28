/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        ui:   ['Mona Sans Variable', 'Mona Sans', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'Menlo', 'monospace'],
      },
      colors: {
        background:  'var(--background)',
        card:        'var(--card)',
        elevated:    'var(--elevated)',
        border:      'var(--border)',
        foreground:  'var(--foreground)',
        muted:       'var(--muted-foreground)',
        secondary:   'var(--secondary-foreground)',
        primary: {
          DEFAULT: 'var(--primary)',
          fg:      'var(--primary-foreground)',
        },
        destructive: 'var(--destructive)',
        success:     'var(--success)',
        warning:     'var(--warning)',
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        sm: 'calc(var(--radius) - 0.25rem)',
        lg: 'calc(var(--radius) + 0.25rem)',
      },
      borderColor: {
        DEFAULT: 'var(--border)',
      },
    },
  },
  plugins: [],
}
