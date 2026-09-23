import React, { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { fantasyAPI } from '../../services/api';
import { readTeamMoney, formatCurrency } from '../../utils/helpers';
import {
  getScheduledAutoClause,
  scheduleAutoClause,
  cancelAutoClause,
  subscribeAutoClauseChanges,
} from '../../services/autoClauseScheduler';

/**
 * AutoClauseToggle — "clausular automáticamente al desbloquear" (ver
 * autoClauseScheduler.js + AutoClauseWatcher.js). Solo tiene sentido mientras
 * la cláusula está bloqueada — el llamador decide cuándo mostrarlo.
 */
const AutoClauseToggle = ({
  leagueId,
  playerTeamId,
  playerName,
  clausulaAmount,
  unlockAt,
  buyerTeamId,
  sellerTeamId,
  className = '',
}) => {
  const [scheduled, setScheduled] = useState(() => !!getScheduledAutoClause(leagueId, playerTeamId));
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const refresh = () => setScheduled(!!getScheduledAutoClause(leagueId, playerTeamId));
    refresh();
    return subscribeAutoClauseChanges(refresh);
  }, [leagueId, playerTeamId]);

  const handleToggle = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (checking) return;

    if (scheduled) {
      cancelAutoClause(leagueId, playerTeamId);
      toast(`Cancelado: ya no se clausulará a ${playerName} automáticamente`, { icon: 'ℹ️' });
      return;
    }

    if (!buyerTeamId || !unlockAt) {
      toast.error('No se pudo programar el clausulazo automático (faltan datos del equipo o del bloqueo)');
      return;
    }

    setChecking(true);
    try {
      const moneyResponse = await fantasyAPI.getTeamMoney(buyerTeamId);
      const money = readTeamMoney(moneyResponse);
      if (typeof money === 'number' && money < clausulaAmount) {
        toast(
          `Ahora mismo no llegas al importe de la cláusula (${formatCurrency(clausulaAmount)}). ` +
            'Se programa igualmente: el saldo se vuelve a comprobar justo al desbloquearse.',
          { icon: '⚠️', duration: 7000 }
        );
      }

      scheduleAutoClause({
        leagueId,
        playerTeamId,
        playerName,
        clausulaAmount,
        unlockAt: new Date(unlockAt).toISOString(),
        buyerTeamId,
        sellerTeamId,
      });
      toast.success(`Programado: se intentará clausular a ${playerName} en cuanto se desbloquee`, {
        duration: 4000,
      });
    } catch (_error) {
      toast.error('No se pudo comprobar tu saldo, inténtalo de nuevo');
    } finally {
      setChecking(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      onMouseDown={(e) => e.preventDefault()}
      disabled={checking}
      aria-pressed={scheduled}
      className={`w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium border transition-colors disabled:opacity-60 ${
        scheduled
          ? 'border-primary-300 bg-primary-50 text-primary-700 hover:bg-primary-100 dark:border-primary-700 dark:bg-primary-900/20 dark:text-primary-300 dark:hover:bg-primary-900/40'
          : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50'
      } ${className}`}
    >
      {scheduled ? (
        <>
          <Bell className="w-3.5 h-3.5" aria-hidden="true" />
          Clausulazo automático programado
        </>
      ) : (
        <>
          <BellOff className="w-3.5 h-3.5" aria-hidden="true" />
          Clausular automáticamente al desbloquear
        </>
      )}
    </button>
  );
};

export default AutoClauseToggle;
