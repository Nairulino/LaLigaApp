jest.mock('./api', () => ({
  fantasyAPI: {
    getTeamMoney: jest.fn(),
    getTeamData: jest.fn(),
    payBuyoutClause: jest.fn(),
  },
}));

import { fantasyAPI } from './api';
import {
  scheduleAutoClause,
  cancelAutoClause,
  getScheduledAutoClause,
  getAllScheduledAutoClauses,
  tickAutoClauseSchedule,
  RETRY_WINDOW_MS,
} from './autoClauseScheduler';

const baseItem = {
  leagueId: 'league1',
  playerTeamId: 'pt1',
  playerName: 'Jugador Test',
  clausulaAmount: 10_000_000,
  buyerTeamId: 'buyer1',
  sellerTeamId: 'seller1',
};

const moneyResponse = (amount) => ({ data: { teamMoney: amount } });

// Respuesta de getTeamData con un único jugador (pt1), ya desbloqueado, con
// el mismo importe que baseItem salvo lo que se sobrescriba.
const teamDataWith = (overrides = {}) => ({
  data: {
    players: [
      {
        playerTeamId: 'pt1',
        buyoutClause: 10_000_000,
        buyoutClauseLockedEndTime: null,
        ...overrides,
      },
    ],
  },
});

const teamDataEmpty = () => ({ data: { players: [] } });

describe('autoClauseScheduler — programar/consultar/cancelar', () => {
  beforeEach(() => localStorage.clear());

  test('sin programar, no hay nada', () => {
    expect(getScheduledAutoClause('league1', 'pt1')).toBeNull();
  });

  test('programa y recupera', () => {
    scheduleAutoClause({ ...baseItem, unlockAt: new Date(Date.now() + 60_000).toISOString() });
    const found = getScheduledAutoClause('league1', 'pt1');
    expect(found).toMatchObject({ playerTeamId: 'pt1', clausulaAmount: 10_000_000 });
  });

  test('ignora si faltan campos obligatorios', () => {
    scheduleAutoClause({ ...baseItem, unlockAt: undefined });
    expect(getAllScheduledAutoClauses()).toHaveLength(0);
  });

  test('cancela un item programado', () => {
    scheduleAutoClause({ ...baseItem, unlockAt: new Date(Date.now() + 60_000).toISOString() });
    cancelAutoClause('league1', 'pt1');
    expect(getScheduledAutoClause('league1', 'pt1')).toBeNull();
  });
});

describe('autoClauseScheduler.tickAutoClauseSchedule', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  test('no dispara nada antes de la hora de desbloqueo', async () => {
    scheduleAutoClause({ ...baseItem, unlockAt: new Date(Date.now() + 60_000).toISOString() });
    const onResult = jest.fn();
    await tickAutoClauseSchedule(onResult);

    expect(fantasyAPI.getTeamData).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
    expect(getScheduledAutoClause('league1', 'pt1')).not.toBeNull();
  });

  test('con saldo suficiente, cláusula sin cambios y pago aceptado: paga, quita de la lista y avisa de éxito', async () => {
    fantasyAPI.getTeamData.mockResolvedValue(teamDataWith());
    fantasyAPI.getTeamMoney.mockResolvedValue(moneyResponse(20_000_000));
    fantasyAPI.payBuyoutClause.mockResolvedValue({ status: 204 });

    scheduleAutoClause({ ...baseItem, unlockAt: new Date(Date.now() - 1000).toISOString() });
    const onResult = jest.fn();
    await tickAutoClauseSchedule(onResult);

    expect(fantasyAPI.payBuyoutClause).toHaveBeenCalledWith('league1', 'pt1', 10_000_000);
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'success', amount: 10_000_000, amountChanged: false })
    );
    expect(getScheduledAutoClause('league1', 'pt1')).toBeNull();
  });

  test('sin saldo suficiente: no paga, quita de la lista y avisa', async () => {
    fantasyAPI.getTeamData.mockResolvedValue(teamDataWith());
    fantasyAPI.getTeamMoney.mockResolvedValue(moneyResponse(5_000_000));

    scheduleAutoClause({ ...baseItem, unlockAt: new Date(Date.now() - 1000).toISOString() });
    const onResult = jest.fn();
    await tickAutoClauseSchedule(onResult);

    expect(fantasyAPI.payBuyoutClause).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'insufficient_funds', money: 5_000_000, amount: 10_000_000 })
    );
    expect(getScheduledAutoClause('league1', 'pt1')).toBeNull();
  });

  test('error definitivo de la API (500): quita de la lista y avisa de error', async () => {
    fantasyAPI.getTeamData.mockResolvedValue(teamDataWith());
    fantasyAPI.getTeamMoney.mockResolvedValue(moneyResponse(20_000_000));
    const apiError = Object.assign(new Error('boom'), { response: { status: 500 } });
    fantasyAPI.payBuyoutClause.mockRejectedValue(apiError);

    scheduleAutoClause({ ...baseItem, unlockAt: new Date(Date.now() - 1000).toISOString() });
    const onResult = jest.fn();
    await tickAutoClauseSchedule(onResult);

    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'error', error: apiError }));
    expect(getScheduledAutoClause('league1', 'pt1')).toBeNull();
  });

  test('400/409 dentro de la ventana de reintento: NO quita de la lista, reintenta en el siguiente tick', async () => {
    fantasyAPI.getTeamData.mockResolvedValue(teamDataWith());
    fantasyAPI.getTeamMoney.mockResolvedValue(moneyResponse(20_000_000));
    const stillLocked = Object.assign(new Error('locked'), { response: { status: 400 } });
    fantasyAPI.payBuyoutClause.mockRejectedValue(stillLocked);

    scheduleAutoClause({ ...baseItem, unlockAt: new Date(Date.now() - 1000).toISOString() });
    const onResult = jest.fn();
    await tickAutoClauseSchedule(onResult);

    expect(onResult).not.toHaveBeenCalled();
    expect(getScheduledAutoClause('league1', 'pt1')).not.toBeNull();
  });

  test('fuera de la ventana de reintento sin éxito: se da por perdido (timeout)', async () => {
    scheduleAutoClause({
      ...baseItem,
      unlockAt: new Date(Date.now() - (RETRY_WINDOW_MS + 5000)).toISOString(),
    });
    const onResult = jest.fn();
    await tickAutoClauseSchedule(onResult);

    expect(fantasyAPI.getTeamData).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'timeout' }));
    expect(getScheduledAutoClause('league1', 'pt1')).toBeNull();
  });

  test('el jugador ya no está en el equipo rival (te lo robaron): quita de la lista y avisa', async () => {
    fantasyAPI.getTeamData.mockResolvedValue(teamDataEmpty());

    scheduleAutoClause({ ...baseItem, unlockAt: new Date(Date.now() - 1000).toISOString() });
    const onResult = jest.fn();
    await tickAutoClauseSchedule(onResult);

    expect(fantasyAPI.getTeamMoney).not.toHaveBeenCalled();
    expect(fantasyAPI.payBuyoutClause).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'player_gone' }));
    expect(getScheduledAutoClause('league1', 'pt1')).toBeNull();
  });

  test('la cláusula se ha vuelto a bloquear (blindaje/subida): reprograma en vez de pagar', async () => {
    const newUnlockAt = new Date(Date.now() + 3_600_000).toISOString();
    fantasyAPI.getTeamData.mockResolvedValue(
      teamDataWith({ buyoutClause: 25_000_000, buyoutClauseLockedEndTime: newUnlockAt })
    );

    scheduleAutoClause({ ...baseItem, unlockAt: new Date(Date.now() - 1000).toISOString() });
    const onResult = jest.fn();
    await tickAutoClauseSchedule(onResult);

    expect(fantasyAPI.getTeamMoney).not.toHaveBeenCalled();
    expect(fantasyAPI.payBuyoutClause).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'rescheduled', newAmount: 25_000_000, newUnlockAt })
    );

    const updated = getScheduledAutoClause('league1', 'pt1');
    expect(updated).toMatchObject({ clausulaAmount: 25_000_000, unlockAt: newUnlockAt });
  });

  test('cláusula subida pero ya desbloqueada de nuevo: paga el importe nuevo, no el viejo', async () => {
    fantasyAPI.getTeamData.mockResolvedValue(teamDataWith({ buyoutClause: 15_000_000 }));
    fantasyAPI.getTeamMoney.mockResolvedValue(moneyResponse(20_000_000));
    fantasyAPI.payBuyoutClause.mockResolvedValue({ status: 204 });

    scheduleAutoClause({ ...baseItem, unlockAt: new Date(Date.now() - 1000).toISOString() });
    const onResult = jest.fn();
    await tickAutoClauseSchedule(onResult);

    expect(fantasyAPI.payBuyoutClause).toHaveBeenCalledWith('league1', 'pt1', 15_000_000);
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'success', amount: 15_000_000, amountChanged: true })
    );
  });

  test('dos ticks solapados no disparan el pago dos veces', async () => {
    let resolveTeamData;
    fantasyAPI.getTeamData.mockReturnValue(new Promise((resolve) => { resolveTeamData = resolve; }));
    fantasyAPI.getTeamMoney.mockResolvedValue(moneyResponse(20_000_000));
    fantasyAPI.payBuyoutClause.mockResolvedValue({ status: 204 });

    scheduleAutoClause({ ...baseItem, unlockAt: new Date(Date.now() - 1000).toISOString() });

    // Primer tick: se queda colgado esperando getTeamData (aún no resuelto).
    const firstTick = tickAutoClauseSchedule(jest.fn());
    // Segundo tick antes de que el primero resuelva: debe ver "firing" y no disparar otra vez.
    await tickAutoClauseSchedule(jest.fn());
    expect(fantasyAPI.getTeamData).toHaveBeenCalledTimes(1);

    resolveTeamData(teamDataWith());
    await firstTick;
    expect(fantasyAPI.payBuyoutClause).toHaveBeenCalledTimes(1);
  });
});
