/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        tobacco: {
          50:  '#fdf6ee',
          100: '#f8e9d2',
          200: '#f0d0a5',
          300: '#e5af6e',
          400: '#d9883a',
          500: '#cc6d1c',
          600: '#b85612',
          700: '#993f11',
          800: '#7c3315',
          900: '#672c16',
          950: '#3d1608',
        },
        ember: {
          400: '#f59e0b',
          500: '#d97706',
          600: '#b45309',
        },
        smoke: {
          800: '#1c1008',
          900: '#120a04',
          950: '#0a0502',
        },
      },
      fontFamily: {
        serif: ['Georgia', 'Cambria', 'Times New Roman', 'serif'],
      },
    },
  },
  plugins: [],
};
