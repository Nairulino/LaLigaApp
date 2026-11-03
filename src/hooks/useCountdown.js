import { useSyncExternalStore } from 'react';
import { getCountdown } from '../utils/clauseUtils';

// Reloj compartido de 1 s: todas las cuentas atrás visibles se suscriben al
// mismo intervalo (en Cláusulas o Mercado puede haber decenas de filas), y el
// intervalo se para en cuanto no queda ningún suscriptor.
const listeners = new Set();
let intervalId = null;
let now = Date.now();

const subscribe = (listener) => {
  listeners.add(listener);
  if (intervalId === null) {
    now = Date.now();
    intervalId = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
};

const noopSubscribe = () => () => {};

const getSnapshot = () => now;

/**
 * useCountdown — cuenta atrás en vivo, a nivel de segundo, hasta `endTime`.
 * Devuelve isOpen=true (y todo a 0) cuando no hay fecha o ya ha pasado; el
 * consumidor reacciona en ese mismo render, sin esperar a un refresco externo.
 */
const useCountdown = (endTime) => {
  // Date.now() además del tick: al montar, el snapshot puede llevar hasta 1 s
  // de retraso respecto al reloj real.
  const countdown = getCountdown(endTime, Date.now());
  // Sin fecha o ya vencida no hay nada que ticar: no se suscribe al reloj.
  useSyncExternalStore(countdown ? subscribe : noopSubscribe, getSnapshot);

  if (!countdown) return { isOpen: true, days: 0, hours: 0, minutes: 0, seconds: 0, totalSeconds: 0 };
  return { isOpen: false, ...countdown };
};

export default useCountdown;
