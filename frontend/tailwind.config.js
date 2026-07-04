/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        hcl: {
          blue: {
            50: '#EBF3FE',
            100: '#D6E7FD',
            200: '#ADCFFB',
            300: '#84B7F9',
            400: '#5B9FF7',
            500: '#0F5FDC',
            600: '#0C4CB0',
            700: '#093A84',
            800: '#062758',
            900: '#03152C',
          },
          teal: {
            50: '#E6F7F7',
            100: '#B3E8E8',
            200: '#80D9D9',
            300: '#4DCACA',
            400: '#26BFBF',
            500: '#00A3A3',
            600: '#008282',
            700: '#006262',
            800: '#004141',
            900: '#002121',
          },
          navy: {
            50: '#E8EBF0',
            100: '#C5CBD9',
            200: '#9FAABF',
            300: '#7A8AA5',
            400: '#556A8B',
            500: '#1A2744',
            600: '#15203A',
            700: '#101930',
            800: '#0B1226',
            900: '#060B1C',
          },
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        'hcl': '0 4px 20px rgba(15, 95, 220, 0.08)',
        'hcl-lg': '0 12px 40px rgba(15, 95, 220, 0.12)',
        'hcl-xl': '0 24px 60px rgba(15, 95, 220, 0.15)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-dot': 'pulseDot 1.4s ease-in-out infinite',
        'shimmer': 'shimmer 1.4s infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseDot: {
          '0%, 80%, 100%': { transform: 'scale(0)', opacity: '0.5' },
          '40%': { transform: 'scale(1)', opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
      },
    },
  },
  plugins: [],
};
