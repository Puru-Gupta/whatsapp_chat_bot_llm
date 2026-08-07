import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        whatsapp: {
          green: "#25D366",
          dark: "#075E54",
          teal: "#128C7E",
          light: "#DCF8C6",
          bg: "#ECE5DD",
        },
      },
    },
  },
  plugins: [],
};

export default config;
