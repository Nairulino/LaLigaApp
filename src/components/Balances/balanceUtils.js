import { extractArray } from '../../utils/helpers';

// Presupuesto inicial: 100.000.000 fijo para todos los participantes desde la
// creación de la liga (confirmado por el propietario). La API no expone el
// saldo de otros managers, así que el saldo de esta vista es SIEMPRE estimado
// reconstruyendo el feed de actividad completo de la temporada.
export const INITIAL_BUDGET = 100_000_000;

// activityTypeId del feed (ver Activity/activityUtils):
//  1 compró · 4 blindó · 6 ganancia por jornada · 7 alineación incorrecta ·
//  9 nuevo miembro · 31 fichó · 32 clausuló · 33 vendió
//
// Flujo de caja por movimiento:
//  - {1,31,32}: el actor (user1) paga el importe; si hay contraparte
//    (user2 = dueño/vendedor), esa contraparte cobra el mismo importe.
//  - {33}: venta al mercado (paga el sistema) → cobra user1.
//  - {4}: blindaje → user1 quema el dinero, nadie cobra.
//  - {6} (o importe sin jugador asociado): premio de jornada → cobra user1.
//  - {7,9}: sin efecto en caja.
const EXPENSE_WITH_COUNTERPARTY = new Set([1, 31, 32]);

const laterDate = (a, b) => {
  if (!a) return b || null;
  if (!b) return a;
  return new Date(a) >= new Date(b) ? a : b;
};

const isEarning = (item, type, amount) =>
  type === 6 ||
  (amount > 0 &&
    type !== 4 &&
    !item?.playerMasterId &&
    !item?.playerName &&
    !item?.player);

/**
 * Reconstruye el saldo estimado de cada manager a partir del feed de actividad
 * completo de la temporada.
 *
 * @param {Array}  activityItems  filas del feed (getLeagueActivity, ya planas)
 * @param {Object} opts
 * @param {number} opts.initialBudget  presupuesto de partida (por defecto 100M)
 * @param {Array}  opts.managers  [{ managerId, managerName, teamId, teamName, teamValue }]
 * @returns {{ rows: Array, movementsUsed: number, unknownTypes: number[], oldestAt: string|null }}
 */
export const computeBalances = (
  activityItems,
  { initialBudget = INITIAL_BUDGET, managers = [] } = {}
) => {
  const acc = new Map();
  const ensure = (id) => {
    const k = String(id);
    if (!acc.has(k)) acc.set(k, { income: 0, expense: 0, ops: 0, lastAt: null });
    return acc.get(k);
  };

  const seenIds = new Set();
  const unknownTypes = new Set();
  let movementsUsed = 0;
  let oldestAt = null;

  for (const item of activityItems || []) {
    if (item?.id != null) {
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
    }

    const at = item?.createdAt || item?.timestamp || null;
    if (at && (!oldestAt || new Date(at) < new Date(oldestAt))) oldestAt = at;

    const amount = Math.abs(Number(item?.amount) || 0);
    if (!amount) continue;

    const type = item?.activityTypeId;
    const u1 = item?.user1Id;
    const u2 = item?.user2Id;

    if (isEarning(item, type, amount)) {
      if (u1 == null) continue;
      const e = ensure(u1);
      e.income += amount;
      e.ops += 1;
      e.lastAt = laterDate(e.lastAt, at);
      movementsUsed += 1;
      continue;
    }

    if (EXPENSE_WITH_COUNTERPARTY.has(type)) {
      if (u1 != null) {
        const b = ensure(u1);
        b.expense += amount;
        b.ops += 1;
        b.lastAt = laterDate(b.lastAt, at);
      }
      if (u2 != null) {
        const s = ensure(u2);
        s.income += amount;
        s.ops += 1;
        s.lastAt = laterDate(s.lastAt, at);
      }
      movementsUsed += 1;
      continue;
    }

    if (type === 33) {
      if (u1 == null) continue;
      const s = ensure(u1);
      s.income += amount;
      s.ops += 1;
      s.lastAt = laterDate(s.lastAt, at);
      movementsUsed += 1;
      continue;
    }

    if (type === 4) {
      if (u1 == null) continue;
      const b = ensure(u1);
      b.expense += amount;
      b.ops += 1;
      b.lastAt = laterDate(b.lastAt, at);
      movementsUsed += 1;
      continue;
    }

    if (type === 7 || type === 9) continue;

    // Tipo con importe que no sabemos interpretar: no lo sumamos (desconocemos
    // el signo) pero lo reportamos para poder mapearlo más adelante.
    if (type != null) unknownTypes.add(type);
  }

  const rows = managers.map((m) => {
    const a = acc.get(String(m.managerId)) || { income: 0, expense: 0, ops: 0, lastAt: null };
    return {
      managerId: m.managerId,
      managerName: m.managerName,
      teamId: m.teamId,
      teamName: m.teamName,
      teamValue: m.teamValue || 0,
      income: a.income,
      expense: a.expense,
      ops: a.ops,
      lastAt: a.lastAt,
      balance: initialBudget + a.income - a.expense,
    };
  });

  return {
    rows,
    movementsUsed,
    unknownTypes: [...unknownTypes].sort((x, y) => x - y),
    oldestAt,
  };
};

// Lista de managers a partir de la clasificación. El id del manager coincide
// con el user1Id/user2Id del feed de actividad.
export const buildManagersList = (ranking) =>
  extractArray(ranking)
    .map((row) => ({
      managerId: row.team?.manager?.id ?? row.userId,
      managerName: row.manager || row.team?.manager?.managerName || 'Manager',
      teamId: row.id || row.team?.id,
      teamName: row.name || row.team?.name || 'Equipo',
      teamValue: row.teamValue ?? row.team?.teamValue ?? 0,
    }))
    .filter((m) => m.managerId != null);
