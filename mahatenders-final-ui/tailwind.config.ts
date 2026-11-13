import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#172235",
        muted: "#6d7787",
        canvas: "#f4f5f2",
        paper: "#fffdfa",
        navy: "#232323",
        copper: "#a65f3b",
        "copper-dark": "#7f4328",
        saffron: "#a65f3b",
        "saffron-light": "#fff2dd",
        field: "#eef2f4",
        line: "#e4e6ea",
        success: "#237b59",
        danger: "#b94a51",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui"],
        serif: ["Georgia", "Times New Roman", "serif"],
      },
      boxShadow: {
        panel: "0 1px 2px rgba(23, 34, 53, 0.04)",
      },
    },
  },
  plugins: [],
};

export default config;
