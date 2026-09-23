import React from 'react';
import { Shield, Clock, Unlock } from 'lucide-react';
import { formatNumberWithDots } from '../../../utils/helpers';
import useClauseCountdown from '../../../hooks/useClauseCountdown';
import AutoClauseToggle from '../../Common/AutoClauseToggle';

const pad = (n) => String(n).padStart(2, '0');

const formatCountdown = (countdown) => {
  const time = `${pad(countdown.hours)}:${pad(countdown.minutes)}:${pad(countdown.seconds)}`;
  return countdown.days > 0 ? `${countdown.days}d ${time}` : time;
};

/**
 * ClauseBuyoutButton — botón "Clausular" (pagar la cláusula de rescisión de
 * un jugador de OTRO manager), con cuenta atrás en vivo (segundos) hasta que
 * se desbloquea. El botón está deshabilitado mientras cuenta y se activa solo
 * en el tick exacto en que useClauseCountdown pasa a isOpen=true.
 */
const ClauseBuyoutButton = ({ player, playerTeam, onClausular, leagueId, buyerTeamId, sellerTeamId }) => {
  const countdown = useClauseCountdown(playerTeam.buyoutClauseLockedEndTime);
  const playerTeamId = playerTeam.playerTeamId || playerTeam.id || player.id;

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (countdown.isOpen) onClausular(player, playerTeam);
        }}
        onMouseDown={(e) => e.preventDefault()}
        disabled={!countdown.isOpen}
        aria-label={
          countdown.isOpen
            ? 'Pagar cláusula de rescisión'
            : `Cláusula bloqueada, quedan ${formatCountdown(countdown)}`
        }
        className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg transition-colors text-sm font-medium ${
          countdown.isOpen
            ? 'bg-green-500 hover:bg-green-600 text-white'
            : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
        }`}
      >
        <Shield className="w-4 h-4" aria-hidden="true" />
        Clausular · {formatNumberWithDots(playerTeam.buyoutClause)}€
      </button>

      <div
        className={`flex items-center justify-center gap-1.5 text-xs font-semibold tabular-nums ${
          countdown.isOpen
            ? 'text-green-600 dark:text-green-400'
            : 'text-red-600 dark:text-red-400'
        }`}
      >
        {countdown.isOpen ? (
          <>
            <Unlock className="w-3 h-3" aria-hidden="true" />
            Clausulable ya
          </>
        ) : (
          <>
            <Clock className="w-3 h-3" aria-hidden="true" />
            Se desbloquea en {formatCountdown(countdown)}
          </>
        )}
      </div>

      {!countdown.isOpen && (
        <AutoClauseToggle
          leagueId={leagueId}
          playerTeamId={playerTeamId}
          playerName={player.nickname || player.name}
          clausulaAmount={playerTeam.buyoutClause}
          unlockAt={playerTeam.buyoutClauseLockedEndTime}
          buyerTeamId={buyerTeamId}
          sellerTeamId={sellerTeamId}
        />
      )}
    </div>
  );
};

export default ClauseBuyoutButton;
