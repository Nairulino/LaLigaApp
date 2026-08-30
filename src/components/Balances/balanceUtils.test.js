import { computeBalances, buildManagersList, INITIAL_BUDGET } from './balanceUtils';

const managers = [
  { managerId: 1, managerName: 'Ana', teamId: 10, teamName: 'AAA', teamValue: 200 },
  { managerId: 2, managerName: 'Bea', teamId: 20, teamName: 'BBB', teamValue: 300 },
  { managerId: 3, managerName: 'Cai', teamId: 30, teamName: 'CCC', teamValue: 400 },
];

const opts = { initialBudget: INITIAL_BUDGET, managers };

describe('computeBalances', () => {
  test('sin actividad, todos parten del presupuesto inicial', () => {
    const { rows } = computeBalances([], opts);
    expect(rows.map((r) => r.balance)).toEqual([INITIAL_BUDGET, INITIAL_BUDGET, INITIAL_BUDGET]);
  });

  test('compra al mercado (tipo 1 sin contraparte): solo gasta el comprador', () => {
    const { rows } = computeBalances(
      [{ id: 'a', activityTypeId: 1, amount: 5_000_000, user1Id: 1, playerMasterId: 99 }],
      opts
    );
    expect(rows.find((r) => r.managerId === 1).balance).toBe(INITIAL_BUDGET - 5_000_000);
    expect(rows.find((r) => r.managerId === 2).balance).toBe(INITIAL_BUDGET);
  });

  test('traspaso entre managers (tipo 31 con user2): comprador paga, vendedor cobra', () => {
    const { rows } = computeBalances(
      [{ id: 'b', activityTypeId: 31, amount: 8_000_000, user1Id: 2, user2Id: 3, playerMasterId: 1 }],
      opts
    );
    expect(rows.find((r) => r.managerId === 2).balance).toBe(INITIAL_BUDGET - 8_000_000);
    expect(rows.find((r) => r.managerId === 3).balance).toBe(INITIAL_BUDGET + 8_000_000);
  });

  test('cláusula (tipo 32): paga el que clausula, cobra el dueño', () => {
    const { rows } = computeBalances(
      [{ id: 'c', activityTypeId: 32, amount: 20_000_000, user1Id: 1, user2Id: 2, playerMasterId: 7 }],
      opts
    );
    expect(rows.find((r) => r.managerId === 1).balance).toBe(INITIAL_BUDGET - 20_000_000);
    expect(rows.find((r) => r.managerId === 2).balance).toBe(INITIAL_BUDGET + 20_000_000);
  });

  test('venta al mercado (tipo 33): cobra el vendedor, nadie paga', () => {
    const { rows } = computeBalances(
      [{ id: 'd', activityTypeId: 33, amount: 3_000_000, user1Id: 3, playerMasterId: 5 }],
      opts
    );
    expect(rows.find((r) => r.managerId === 3).balance).toBe(INITIAL_BUDGET + 3_000_000);
  });

  test('blindaje (tipo 4): el dinero se quema', () => {
    const { rows } = computeBalances(
      [{ id: 'e', activityTypeId: 4, amount: 1_500_000, user1Id: 1, playerMasterId: 5 }],
      opts
    );
    expect(rows.find((r) => r.managerId === 1).balance).toBe(INITIAL_BUDGET - 1_500_000);
  });

  test('premio de jornada (tipo 6 y variante sin jugador): suma al manager', () => {
    const { rows } = computeBalances(
      [
        { id: 'f', activityTypeId: 6, amount: 200_000, user1Id: 1 },
        { id: 'g', activityTypeId: 99, amount: 150_000, user1Id: 2 }, // sin jugador → premio
      ],
      opts
    );
    expect(rows.find((r) => r.managerId === 1).balance).toBe(INITIAL_BUDGET + 200_000);
    expect(rows.find((r) => r.managerId === 2).balance).toBe(INITIAL_BUDGET + 150_000);
  });

  test('deduplica por id repetido', () => {
    const item = { id: 'x', activityTypeId: 1, amount: 4_000_000, user1Id: 1, playerMasterId: 2 };
    const { rows, movementsUsed } = computeBalances([item, item], opts);
    expect(rows.find((r) => r.managerId === 1).balance).toBe(INITIAL_BUDGET - 4_000_000);
    expect(movementsUsed).toBe(1);
  });

  test('tipos desconocidos con importe se reportan y no se suman', () => {
    const { rows, unknownTypes } = computeBalances(
      [{ id: 'u', activityTypeId: 55, amount: 9_000_000, user1Id: 1, playerMasterId: 2 }],
      opts
    );
    expect(unknownTypes).toEqual([55]);
    expect(rows.find((r) => r.managerId === 1).balance).toBe(INITIAL_BUDGET);
  });

  test('ignora movimientos sin importe y tipos 7/9', () => {
    const { rows, movementsUsed } = computeBalances(
      [
        { id: 'h', activityTypeId: 7, user1Id: 1, weekNumber: 2 },
        { id: 'i', activityTypeId: 9, user1Id: 2 },
        { id: 'j', activityTypeId: 1, amount: 0, user1Id: 1 },
      ],
      opts
    );
    expect(movementsUsed).toBe(0);
    expect(rows.every((r) => r.balance === INITIAL_BUDGET)).toBe(true);
  });

  test('oldestAt es la fecha más antigua vista', () => {
    const { oldestAt } = computeBalances(
      [
        { id: 'k', activityTypeId: 6, amount: 1, user1Id: 1, createdAt: '2026-02-01T00:00:00Z' },
        { id: 'l', activityTypeId: 6, amount: 1, user1Id: 1, createdAt: '2025-09-15T00:00:00Z' },
      ],
      opts
    );
    expect(oldestAt).toBe('2025-09-15T00:00:00Z');
  });
});

describe('buildManagersList', () => {
  test('extrae id de manager, equipo y valor de la clasificación', () => {
    const ranking = {
      data: [
        { id: 10, name: 'AAA', teamValue: 200, team: { id: 10, manager: { id: 1, managerName: 'Ana' } } },
        { id: 20, name: 'BBB', team: { id: 20, teamValue: 300, manager: { id: 2, managerName: 'Bea' } } },
      ],
    };
    expect(buildManagersList(ranking)).toEqual([
      { managerId: 1, managerName: 'Ana', teamId: 10, teamName: 'AAA', teamValue: 200 },
      { managerId: 2, managerName: 'Bea', teamId: 20, teamName: 'BBB', teamValue: 300 },
    ]);
  });

  test('descarta filas sin id de manager', () => {
    const ranking = { data: [{ id: 5, name: 'X', team: { id: 5 } }] };
    expect(buildManagersList(ranking)).toEqual([]);
  });
});
