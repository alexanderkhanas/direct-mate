/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Geologica', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#f8f9fa',
          100: '#f1f3f5',
          900: '#111827',
        },
        // Setup design tokens (design canvas «DirectMate Onboarding Design»). The accent is Tailwind's blue-600/700/800.
        dm: {
          bg: '#F5F7FA',
          sunken: '#F9FAFC',
          ink: '#121826',
          ink2: '#374151',
          muted: '#5B6474',
          faint: '#9AA3B2',
          line: '#E3E7EE',
          line2: '#CBD2DD',
          bubble: '#EEF1F5',
          skel: '#EBEEF3',
          green: '#15803D',
          'green-icon': '#16A34A',
          'green-bg': '#EEFBF3',
          'green-line': '#BBEACB',
          amber: '#A15C07',
          'amber-ink': '#7A4505',
          'amber-bg': '#FFF8EB',
          'amber-line': '#F5D49C',
          red: '#B42318',
          'red-bg': '#FEF3F2',
          'red-line': '#FBCBC6',
        },
      },
      boxShadow: {
        dm: '0 1px 2px rgba(18,24,38,.06), 0 6px 20px rgba(18,24,38,.07)',
        'dm-up': '0 -1px 0 #E3E7EE, 0 -8px 24px rgba(18,24,38,.05)',
        'dm-sheet': '0 -8px 32px rgba(18,24,38,.18)',
      },
    },
  },
  plugins: [],
};
