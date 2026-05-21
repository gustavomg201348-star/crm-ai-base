import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#172033",
        paper: "#F6F8FB",
        line: "#E6EAF1",
        brand: "#2563EB",
        saffron: "#D97706",
        berry: "#E11D48"
      },
      boxShadow: {
        soft: "0 12px 36px rgba(15, 23, 42, 0.06)",
        lift: "0 18px 50px rgba(15, 23, 42, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
