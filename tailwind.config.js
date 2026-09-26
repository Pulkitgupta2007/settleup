/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ledger: {
          canvas: '#F8F9FA',      // Crisp archival ledger paper off-white
          panel: '#FFFFFF',       // Pure white sheet surface
          subpanel: '#F1F3F5',    // Recessed data surface / table headers
          border: '#E2E5E9',      // Crisp architectural 1px hairline rule
          subtle: '#EDF0F3',      // Subtle table row divider
          highlight: '#CBD5E1',   // Focused / active border
        },
        bone: {
          DEFAULT: '#0F172A',     // Deep carbon ink (Primary text & prominent numerals)
          muted: '#475569',       // Account slate (Secondary labels, column headers)
          dark: '#64748B',        // Tertiary metadata & quiet timestamps
        },
        debt: {
          DEFAULT: '#E11D48',     // Crimson Debit (Obligations / Outbound)
          light: '#E11D48',
          bg: '#FFF1F2',          // Subtle rose tint
          border: '#FECDD3',      // Rose border
        },
        credit: {
          DEFAULT: '#059669',     // Emerald Credit (Receivables / Inbound Assets)
          light: '#047857',
          bg: '#ECFDF5',          // Subtle mint tint
          border: '#A7F3D0',      // Mint border
        },
        brass: {
          DEFAULT: '#D97706',     // Warm Amber / Neutral Conduit
          bg: '#FFFBEB',          // Subtle amber tint
          border: '#FDE68A',      // Amber border
        },
        action: {
          DEFAULT: '#0F172A',     // Dark carbon action button
          hover: '#1E293B',
          text: '#FFFFFF',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'Newsreader', 'Fraunces', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'IBM Plex Sans', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['var(--font-mono)', 'JetBrains Mono', 'SF Mono', 'Fira Code', 'Menlo', 'monospace'],
      },
      borderRadius: {
        none: '0px',
        sm: '2px',
        DEFAULT: '2px',
      },
      boxShadow: {
        none: 'none',
        'subtle-border': '0 0 0 1px rgba(255, 255, 255, 0.05)',
      },
    },
  },
  plugins: [],
};
