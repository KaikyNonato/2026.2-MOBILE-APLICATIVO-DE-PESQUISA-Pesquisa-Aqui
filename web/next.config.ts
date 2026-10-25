import type { NextConfig } from "next";

// URL da API (NestJS). Em desenvolvimento continua sendo o localhost de sempre.
// Na Vercel, defina API_URL (ex.: https://pesquisa-aqui-api.vercel.app) ANTES do build:
// o redirecionamento abaixo é gravado no momento do build.
const API_URL = (process.env.API_URL || "http://localhost:3001").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        // O navegador chama /api/... no próprio domínio do painel e a Vercel repassa para a API.
        // Assim o cookie `access_token` fica no domínio do painel (o proxy.ts consegue lê-lo)
        // e não há problema de CORS nem de SameSite entre domínios diferentes.
        source: "/api/:path*",
        destination: `${API_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
