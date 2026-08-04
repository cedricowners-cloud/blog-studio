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
        brand: {
          DEFAULT: "#1E3A8A", // Navy (진중, 전문적)
          50: "#EFF6FF",      // 연한 블루 (포커스/호버 배경)
          600: "#1E40AF",     // 호버 시 약간 밝은 네이비
        },
      },
    },
  },
  plugins: [],
};

export default config;
