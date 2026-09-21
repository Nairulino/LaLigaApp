/**
 * trendNameOverrides — alias de nombre "LaLiga → futbolfantasy" que el propio
 * usuario puede añadir desde la ficha del jugador cuando sale "Sin datos de
 * tendencia" y ya sabe con qué nombre aparece en la fuente scrapeada
 * (futbolfantasy.com). Complementa la tabla estática de casos conocidos en
 * mapSpecialNameForTrends (utils/playerNameMatcher.js): esa tabla la
 * mantenemos en el código porque vale para todo el mundo; esto es para poder
 * arreglar un caso nuevo sin esperar a un cambio de código y un redeploy.
 *
 * Solo persiste en localStorage: es por navegador, no se comparte entre
 * dispositivos ni con el resto de la liga.
 */
import { normalizePlayerName } from '../utils/playerNameMatcher';

const STORAGE_KEY = 'laliga_trend_name_overrides';

const readAll = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeAll = (overrides) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // localStorage lleno/bloqueado: el alias no persiste, pero no debe
    // romper el flujo de guardado.
  }
};

/**
 * Alias guardado para un nombre de LaLiga (nickname o name tal cual llega de
 * la API), o null si no hay ninguno. `laligaName` se normaliza igual que el
 * resto del matcher, así que da igual la forma exacta en que se guardó.
 */
export const getTrendNameOverride = (laligaName) => {
  if (!laligaName) return null;
  const key = normalizePlayerName(laligaName);
  if (!key) return null;
  return readAll()[key] || null;
};

/**
 * Guarda/actualiza el alias. `futbolfantasyName` es el nombre exacto (o lo
 * más exacto posible) que usa la fuente de tendencias para ese jugador.
 */
export const setTrendNameOverride = (laligaName, futbolfantasyName) => {
  const key = normalizePlayerName(laligaName);
  const value = (futbolfantasyName || '').trim();
  if (!key || !value) return;
  const overrides = readAll();
  overrides[key] = value;
  writeAll(overrides);
};

export const removeTrendNameOverride = (laligaName) => {
  const key = normalizePlayerName(laligaName);
  if (!key) return;
  const overrides = readAll();
  if (!(key in overrides)) return;
  delete overrides[key];
  writeAll(overrides);
};

export const getAllTrendNameOverrides = () => readAll();
