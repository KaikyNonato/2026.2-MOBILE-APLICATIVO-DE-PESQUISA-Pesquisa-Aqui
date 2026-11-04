"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type CountUpProps = {
  /** Número a mostrar. Qualquer outro valor (ex.: "–" durante o carregamento) aparece como está. */
  value: ReactNode;
  /** Duração em ms (padrão 900, faixa "revelação" da skill de motion). */
  duration?: number;
  /** Formata o número exibido (recebe o valor em andamento, sem arredondar). Padrão: inteiro. */
  format?: (n: number) => string;
};

/** Curva de animação que começa rápida e desacelera no fim. */
const easeOutExpo = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

/**
 * Número que conta do valor anterior até o novo (desacelera no final).
 * Respeita "reduzir movimento" e nunca anima valores que não sejam numéricos.
 */
export function CountUp({ value, duration = 900, format }: CountUpProps) {
  const target = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const isNumber = typeof value === "number" && Number.isFinite(value);
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    if (!isNumber) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      fromRef.current = target;
      setDisplay(target);
      return;
    }

    const from = fromRef.current;
    if (from === target) return;

    let frame = 0;
    let start: number | null = null;

    const tick = (now: number) => {
      if (start === null) start = now;
      const progress = Math.min((now - start) / duration, 1);
      const current = from + (target - from) * easeOutExpo(progress);
      fromRef.current = current;
      setDisplay(current);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isNumber, target, duration]);

  if (!isNumber) return <>{value}</>;

  // Sem <span>: o CSS dos painéis estiliza "span" dentro de alguns blocos (ex.: .pa-gauge .v span).
  // O alinhamento tabular dos dígitos vem do CSS do elemento pai.
  return <>{format ? format(display) : Math.round(display)}</>;
}
