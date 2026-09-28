/**
 * autoClauseScheduler — "clausular automáticamente al desbloquear".
 *
 * Esta app no tiene backend propio con tareas programadas (el servidor Node
 * es solo un proxy), así que esto es forzosamente client-side: persiste la
 * lista de objetivos en localStorage (sobrevive a recargas/navegación) y un
 * watcher montado una vez a nivel de app (components/Common/AutoClauseWatcher.js)
 * la revisa cada segundo y dispara el pago en cuanto toca. Solo funciona
 * mientras esta pestaña esté cargada — y con precisión de segundo solo si
 * está en primer plano, porque los navegadores throttlean los timers en
 * pestañas de fondo.
 *
 * Módulo puro: no importa React ni react-query, para poder testearlo sin
 * montar nada. El watcher (que sí necesita queryClient para invalidar caché
 * tras un pago con éxito) vive en un componente aparte.
 */
import { fantasyAPI } from './api';
import { readTeamMoney } from '../utils/helpers';
import { extractTeamPlayers } from '../utils/fetchAllTeamsData';

const STORAGE_KEY = 'laliga_auto_clause_schedule';
const EVENT_NAME = 'laliga:auto-clause-changed';

// Tras la hora objetivo, cuánto se reintenta antes de darlo por perdido:
// cubre desfase de reloj cliente/servidor y el throttling de timers en
// pestañas de fondo (la primera comprobación tras volver a foreground puede
// llegar varios segundos tarde).
export const RETRY_WINDOW_MS = 20_000;
export const TICK_INTERVAL_MS = 1_000;
// Si un intento queda marcado "firing" más de esto sin resolverse (p.ej. la
// pestaña se cerró a mitad de la petición), se considera colgado y se libera
// para que el siguiente tick lo reintente.
const STALE_FIRING_MS = 10_000;

const readAll = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeAll = (all) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // localStorage lleno/bloqueado: no persiste, pero no debe romper el flujo.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(EVENT_NAME));
  }
};

const keyFor = (leagueId, playerTeamId) => `${leagueId}:${playerTeamId}`;

/** Alias/objetivo programado para esa cláusula, o null si no hay ninguno. */
export const getScheduledAutoClause = (leagueId, playerTeamId) => {
  if (!leagueId || !playerTeamId) return null;
  return readAll()[keyFor(leagueId, playerTeamId)] || null;
};

export const getAllScheduledAutoClauses = () => Object.values(readAll());

/**
 * Programa un clausulazo automático. `item` lleva la foto del momento de
 * programar: leagueId, playerTeamId, playerName, clausulaAmount, unlockAt
 * (ISO), buyerTeamId (tu equipo), sellerTeamId (el equipo rival, para
 * invalidar caché al éxito). El saldo y el propio estado de la cláusula
 * (importe/bloqueo) se vuelven a comprobar en caliente justo antes de pagar
 * — pueden haber cambiado (el dueño puede blindar o subir la cláusula, o
 * otro manager puede adelantarse).
 */
export const scheduleAutoClause = (item) => {
  if (!item?.leagueId || !item?.playerTeamId || !item?.unlockAt || !item?.clausulaAmount) return;
  const all = readAll();
  all[keyFor(item.leagueId, item.playerTeamId)] = { ...item, scheduledAt: new Date().toISOString() };
  writeAll(all);
};

export const cancelAutoClause = (leagueId, playerTeamId) => {
  const all = readAll();
  const key = keyFor(leagueId, playerTeamId);
  if (!(key in all)) return;
  delete all[key];
  writeAll(all);
};

const removeScheduled = (item) => {
  const all = readAll();
  delete all[keyFor(item.leagueId, item.playerTeamId)];
  writeAll(all);
};

/** Marca el item como "en curso" para que un tick solapado no lo dispare dos veces. */
const markFiring = (item) => {
  const all = readAll();
  const key = keyFor(item.leagueId, item.playerTeamId);
  if (!all[key]) return false; // lo canceló el usuario justo ahora
  all[key] = { ...all[key], firing: true, firingAt: new Date().toISOString() };
  writeAll(all);
  return true;
};

/**
 * Libera la marca "en curso" de un intento que terminó pero hay que
 * reintentar (400/409 dentro de ventana, respuesta rara): si no se libera, el
 * guard de STALE_FIRING_MS lo dejaría sin tocar hasta 10s en vez de
 * reintentarlo en el siguiente tick de 1s.
 */
const unmarkFiring = (item) => {
  const all = readAll();
  const key = keyFor(item.leagueId, item.playerTeamId);
  if (!all[key]) return;
  const { firing: _firing, firingAt: _firingAt, ...rest } = all[key];
  all[key] = rest;
  writeAll(all);
};

/** Reprograma un item con datos frescos (nuevo importe/hora), sin resolverlo. */
const rescheduleWithFreshData = (item, current) => {
  const all = readAll();
  const key = keyFor(item.leagueId, item.playerTeamId);
  if (!all[key]) return; // lo canceló el usuario justo ahora
  const { firing: _firing, firingAt: _firingAt, ...rest } = all[key];
  all[key] = { ...rest, clausulaAmount: current.clausulaAmount, unlockAt: current.unlockAt };
  writeAll(all);
};

export const subscribeAutoClauseChanges = (callback) => {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(EVENT_NAME, callback);
  return () => window.removeEventListener(EVENT_NAME, callback);
};

/**
 * Relee el estado ACTUAL de la cláusula justo antes de pagar (el importe y la
 * hora de desbloqueo guardados al programar son una foto fija; el dueño pudo
 * blindar o subir la cláusula después). Devuelve null si el jugador ya no
 * está en ese equipo (alguien se adelantó) o ya no tiene cláusula.
 */
const fetchCurrentClauseState = async (item) => {
  const teamDataResponse = await fantasyAPI.getTeamData(item.leagueId, item.sellerTeamId);
  const players = extractTeamPlayers(teamDataResponse);
  const match = players.find((pt) => {
    const id = pt.playerTeamId || pt.id;
    return id != null && String(id) === String(item.playerTeamId);
  });
  if (!match || !match.buyoutClause) return null;
  return {
    clausulaAmount: match.buyoutClause,
    unlockAt: match.buyoutClauseLockedEndTime || null,
  };
};

/**
 * Un intento de pago. Antes de nada relee la cláusula (importe + bloqueo)
 * porque pudo cambiar desde que se programó, y el saldo (autoritativo).
 * Devuelve true si el item ha quedado resuelto (éxito, fallo definitivo o
 * reprogramado — ya no está pendiente con los datos viejos) y false si hay
 * que reintentar en el siguiente tick (dentro de RETRY_WINDOW_MS).
 */
const attemptPayment = async (item, onResult) => {
  try {
    const current = await fetchCurrentClauseState(item);

    if (!current) {
      // Ya no está en el equipo rival: alguien se lo quedó antes (clausulazo
      // de otro manager, venta, etc.) — no hay nada que pagar.
      removeScheduled(item);
      onResult?.({ item, outcome: 'player_gone' });
      return true;
    }

    if (current.unlockAt && new Date(current.unlockAt).getTime() > Date.now()) {
      // Se ha vuelto a bloquear (blindaje o subida de cláusula) después de
      // programarlo: en vez de abandonar, reprogramamos con el importe y la
      // hora nuevos y lo recogerá un tick futuro.
      rescheduleWithFreshData(item, current);
      onResult?.({ item, outcome: 'rescheduled', newAmount: current.clausulaAmount, newUnlockAt: current.unlockAt });
      return true;
    }

    const amount = current.clausulaAmount;
    const amountChanged = amount !== item.clausulaAmount;

    const moneyResponse = await fantasyAPI.getTeamMoney(item.buyerTeamId);
    const money = readTeamMoney(moneyResponse);
    if (typeof money === 'number' && money < amount) {
      removeScheduled(item);
      onResult?.({ item, outcome: 'insufficient_funds', money, amount, amountChanged });
      return true;
    }

    const response = await fantasyAPI.payBuyoutClause(item.leagueId, item.playerTeamId, amount);

    if (response && (response.status === 200 || response.status === 204)) {
      removeScheduled(item);
      onResult?.({ item, outcome: 'success', amount, amountChanged });
      return true;
    }

    unmarkFiring(item); // respuesta no reconocida: reintentar dentro de la ventana
    return false;
  } catch (error) {
    const status = error?.response?.status;
    // 400/409 dentro de la ventana puede ser solo desfase de reloj (la API
    // aún la ve bloqueada) — reintentar. Cualquier otro código es definitivo.
    if (status && status !== 400 && status !== 409) {
      removeScheduled(item);
      onResult?.({ item, outcome: 'error', error });
      return true;
    }
    unmarkFiring(item);
    return false;
  }
};

/**
 * Un tick del watcher: recorre la lista y dispara los que ya tocan. Se llama
 * cada TICK_INTERVAL_MS mientras la pestaña esté abierta (ver
 * AutoClauseWatcher.js). `onResult` se invoca una vez por item resuelto (no
 * en 'rescheduled', que sigue pendiente), `{ item, outcome, ...datos }` con
 * outcome en:
 *  - 'success' (pagada; `amount` es el importe realmente pagado, `amountChanged`
 *    si difería del programado)
 *  - 'insufficient_funds' (`money`, `amount`, `amountChanged`)
 *  - 'player_gone' (alguien se adelantó: ya no está en el equipo rival)
 *  - 'rescheduled' (se blindó/subió la cláusula: reprogramado con `newAmount`/`newUnlockAt`)
 *  - 'timeout' (se pasó la ventana de reintento sin resolverse)
 *  - 'error' (fallo definitivo de la API; `error`)
 */
export const tickAutoClauseSchedule = (onResult) => {
  const now = Date.now();
  const all = readAll();
  const pending = [];

  for (const item of Object.values(all)) {
    const unlockTime = new Date(item.unlockAt).getTime();
    if (Number.isNaN(unlockTime) || now < unlockTime) continue;

    if (now - unlockTime > RETRY_WINDOW_MS) {
      removeScheduled(item);
      onResult?.({ item, outcome: 'timeout' });
      continue;
    }

    if (item.firing) {
      const firingSince = item.firingAt ? new Date(item.firingAt).getTime() : 0;
      if (now - firingSince < STALE_FIRING_MS) continue; // ya en curso, no dupliques
    }

    if (!markFiring(item)) continue; // el usuario lo canceló justo ahora
    pending.push(attemptPayment(item, onResult));
  }

  return Promise.all(pending);
};
