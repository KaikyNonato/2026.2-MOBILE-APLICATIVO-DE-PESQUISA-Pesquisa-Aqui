// Configurações de segurança lidas do ambiente, separadas do main.ts para poderem ser testadas.

/** Lista de origens permitidas a partir de CORS_ORIGINS (separadas por vírgula, sem barra no final). */
export function parseOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/**
 * Decide se uma origem de navegador pode chamar a API.
 * - sem `Origin` (app mobile, curl, servidor do painel): liberado, não é navegador;
 * - origem na lista CORS_ORIGINS: liberada;
 * - lista vazia em desenvolvimento: liberada (para não atrapalhar quem está começando);
 * - qualquer outro caso, inclusive lista vazia em produção: negada.
 */
export function isOriginAllowed(origin: string | undefined, allowed: string[], production: boolean): boolean {
  if (!origin) return true;
  if (allowed.includes(origin.replace(/\/+$/, ''))) return true;

  return allowed.length === 0 && !production;
}

export function corsOriginCheck() {
  const allowed = parseOrigins(process.env.CORS_ORIGINS);
  const production = process.env.NODE_ENV === 'production';

  return (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
    callback(null, isOriginAllowed(origin, allowed, production));
  };
}

/** TRUST_PROXY: número de proxies à frente da API (ex.: 1), `true`, ou vazio/`false` para não confiar em nenhum. */
export function trustProxySetting(value = process.env.TRUST_PROXY): number | boolean {
  if (!value || value === 'false' || value === '0') return false;
  if (value === 'true') return true;

  const hops = Number.parseInt(value, 10);

  return Number.isFinite(hops) && hops > 0 ? hops : false;
}
