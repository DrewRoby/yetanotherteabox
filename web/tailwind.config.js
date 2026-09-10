/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Ming Dynasty palette, per tech_stack_document.md / wireframes.
        crimson: "#b91c1c",
        crimson2: "#a62c2b",
        gold: "#d4af37",
        ink: "#1a1a1a",
        bone: "#f8f3e7",
        bone2: "#f5f2e9",
      },
      fontFamily: {
        serif: ['"Playfair Display"', '"Noto Serif SC"', "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};
