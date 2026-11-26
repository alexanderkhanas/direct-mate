/**
 * The admin's design tokens (apps/admin/tailwind.config.js, `dm-*`), plus the few the marketing pages add.
 * The accent is Tailwind's blue-600/700/800, as in the admin.
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ['./src/**/*.{astro,html,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Geologica', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      colors: {
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
          avatar: '#D5DCE8',
          tint: '#EFF4FF',
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
          // The dark band («AI пише відповідь…», «Три перевірки»).
          'night-text': '#C5CCD8',
          'night-card': '#1B2333',
          'night-line': '#2B3345',
        },
      },
      maxWidth: {
        page: '1160px',
      },
      boxShadow: {
        dm: '0 1px 2px rgba(18,24,38,.06), 0 6px 20px rgba(18,24,38,.07)',
      },
    },
  },
  plugins: [],
};
