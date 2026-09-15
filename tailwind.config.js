/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        night: 'rgb(7 7 8 / <alpha-value>)',
        panel: 'rgb(15 14 17 / <alpha-value>)',
        card: 'rgb(11 11 13 / <alpha-value>)',
        ink: 'rgb(var(--ink-rgb) / <alpha-value>)',
        muted: 'rgb(var(--muted-rgb) / <alpha-value>)',
        violet: { glow: 'rgb(var(--accent-rgb) / <alpha-value>)', deep: 'rgb(var(--accent-deep-rgb) / <alpha-value>)' },
        lilac: 'rgb(var(--lilac-rgb) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      maxWidth: { shell: 'var(--shell-max)' },
      borderRadius: { lg: 'var(--radius-sm)', xl: 'var(--radius-card)', '2xl': 'var(--radius-lg)', '3xl': 'var(--radius-xl)' },
      transitionDuration: { 150: 'var(--dur-fast)', 200: 'var(--dur)', 300: 'var(--dur-section)' },
      transitionTimingFunction: { out: 'var(--ease)' },
      boxShadow: {
        glow: 'var(--inner-highlight), 0 3px 12px -6px rgba(0,0,0,.45)',
        'glow-sm': 'var(--inner-highlight)',
        panel: 'var(--shadow-panel)',
      },
      keyframes: {
        fadeUp: { from: {opacity: '0', transform: 'translateY(5px)'}, to: {opacity: '1', transform: 'none'} },
        pop: { from: {opacity: '0', transform: 'translateY(-4px) scale(.98)'}, to: {opacity: '1', transform: 'none'} },
        shimmer: { from: {transform: 'translateX(-100%)'}, to: {transform: 'translateX(100%)'} },
        barPulse: {'0%,100%': {opacity: '.55'}, '50%': {opacity: '1'}},
      },
      animation: {
        'fade-up': 'fadeUp var(--dur-section) var(--ease) both',
        'liquid-in': 'fadeUp var(--dur-section) var(--ease) both',
        'page-in': 'fadeUp var(--dur-section) var(--ease) both',
        pop: 'pop var(--dur) var(--ease) both',
        'check-pop': 'fadeUp var(--dur-fast) var(--ease) both',
        shimmer: 'shimmer 1.6s linear infinite',
        'bar-pulse': 'barPulse 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
