import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: ["dist/**", ".next/**", ".wrangler/**", ".sites-runtime/**", "node_modules/**", "vendor/**", "next-env.d.ts"] },
];

export default config;
