jest.mock('./api', () => ({
  fantasyAPI: {
    getTeamMoney: jest.fn(),
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

    expect(fantasyAPI.getTeamMoney).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
    expect(getScheduledAutoClause('league1', 'pt1')).not.toBeNull();
  });

  test('con saldo suficiente y pago aceptado: paga, quita de la lista y avisa de éxito', async () => {
    fantasyAPI.getTeamMoney.mockResolvedValue(moneyResponse(20_000_000));
    fantasyAPI.payBuyoutClause.mockResolvedValue({ status: 204 });

    scheduleAutoClause({ ...baseItem, unlockAt: new Date(Date.now() - 1000).toISOString() });
    const onResult = jest.fn();
    await tickAutoClauseSchedule(onResult);

    expect(fantasyAPI.payBuyoutClause).toHaveBeenCalledWith('league1', 'pt1', 10_000_000);
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success' }));
    expect(getScheduledAutoClause('league1', 'pt1')).toBeNull();
  });

  test('sin saldo suficiente: no paga, quita de la lista y avisa', async () => {
    fantasyAPI.getTeamMoney.mockResolvedValue(moneyResponse(5_000_000));

    scheduleAutoClause({ ...baseItem, unlockAt: new Date(Date.now() - 1000).toISOString() });
    const onResult = jest.fn();
    await tickAutoClauseSchedule(onResult);

    expect(fantasyAPI.payBuyoutClause).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'insufficient_funds', money: 5_000_000 })
    );
    expect(getScheduledAutoClause('league1', 'pt1')).toBeNull();
  });

  test('error definitivo de la API (500): quita de la lista y avisa de error', async () => {
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

    expect(fantasyAPI.getTeamMoney).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'timeout' }));
    expect(getScheduledAutoClause('league1', 'pt1')).toBeNull();
  });

  test('dos ticks solapados no disparan el pago dos veces', async () => {
    let resolveMoney;
    fantasyAPI.getTeamMoney.mockReturnValue(new Promise((resolve) => { resolveMoney = resolve; }));
    fantasyAPI.payBuyoutClause.mockResolvedValue({ status: 204 });

    scheduleAutoClause({ ...baseItem, unlockAt: new Date(Date.now() - 1000).toISOString() });

    // Primer tick: se queda colgado esperando getTeamMoney (aún no resuelto).
    const firstTick = tickAutoClauseSchedule(jest.fn());
    // Segundo tick antes de que el primero resuelva: debe ver "firing" y no disparar otra vez.
    await tickAutoClauseSchedule(jest.fn());
    expect(fantasyAPI.getTeamMoney).toHaveBeenCalledTimes(1);

    resolveMoney(moneyResponse(20_000_000));
    await firstTick;
    expect(fantasyAPI.payBuyoutClause).toHaveBeenCalledTimes(1);
  });
});
