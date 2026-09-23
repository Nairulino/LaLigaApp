import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { tickAutoClauseSchedule, TICK_INTERVAL_MS } from '../../services/autoClauseScheduler';
import { invalidateAfterClausePurchase } from '../../utils/cacheInvalidation';
import { formatCurrency } from '../../utils/helpers';

/**
 * AutoClauseWatcher — montado una vez en Layout.js (vive mientras haya
 * sesión, sin importar la ruta). Revisa cada segundo si algún "clausulazo
 * automático" programado (ver autoClauseScheduler.js + AutoClauseToggle.js)
 * ya toca y lo dispara.
 *
 * No renderiza nada: es puro efecto secundario + notificaciones toast.
 */
const AutoClauseWatcher = () => {
  const queryClient = useQueryClient();
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;

  useEffect(() => {
    const handleResult = ({ item, outcome, money, error }) => {
      switch (outcome) {
        case 'success':
          invalidateAfterClausePurchase(
            queryClientRef.current,
            item.leagueId,
            item.buyerTeamId,
            item.sellerTeamId
          );
          toast.success(`⚡ Clausulazo automático: ${item.playerName} fichado al desbloquearse`, {
            duration: 6000,
          });
          break;

        case 'insufficient_funds':
          toast.error(
            `No se pudo clausular a ${item.playerName} automáticamente: saldo insuficiente` +
              (typeof money === 'number' ? ` (tienes ${formatCurrency(money)}, faltan)` : ''),
            { duration: 7000 }
          );
          break;

        case 'timeout':
          toast.error(
            `No se pudo clausular a ${item.playerName} a tiempo (la pestaña pudo estar en segundo plano)`,
            { duration: 7000 }
          );
          break;

        case 'error':
        default: {
          const apiMessage = error?.response?.data?.message || error?.response?.data?.error;
          toast.error(
            `Error al clausular automáticamente a ${item.playerName}` +
              (apiMessage ? `: ${apiMessage}` : ''),
            { duration: 7000 }
          );
          break;
        }
      }
    };

    const tick = () => tickAutoClauseSchedule(handleResult);
    tick();
    const id = setInterval(tick, TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return null;
};

export default AutoClauseWatcher;
