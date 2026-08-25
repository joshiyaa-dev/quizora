/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Quizora — Deep Space Quiz Adventure
        // A full-stack quiz game that feels like an adventure through worlds
        bg: '#0A0E24',
        surface: '#1B233B',
        border: '#2D3748',
        'border-strong': '#4A5568',
        ink: '#F7F8FA',
        ink_secondary: '#CBD5E0',
        ink_muted: '#98A2C2',
        accent: '#FFD93D', // Golden — like quiz lightbulb moments
        success: '#38BDF8',
        danger: '#F87171',
        warning: '#F6AD55',
        card: '#1E293B',
        muted: '#718096',
        orbit: '#7B61FF',
        nebula: '#FFB627',
      },
      borderRadius: {
        md: '6px',
        lg: '10px',
        full: '9999px',
      },
      boxShadow: {
        md: '0 4px 20px rgba(0,0,0,.4)',
        lg: '0 8px 32px rgba(0,0,0,.5)',
        inner: 'inset 0 2px 4px rgba(0,0,0,.3)',
        glow: '0 0 20px rgba(255,217,61,.3)',
      },
    },
  },
  plugins: [],
}