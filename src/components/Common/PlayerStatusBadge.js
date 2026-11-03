import React from 'react';
import { getPlayerStatus } from '../../utils/helpers';

/**
 * PlayerStatusBadge — indicador de lesión / duda / sanción a partir del
 * playerStatus del API. No pinta nada si el jugador está disponible.
 * `compact` muestra solo el icono (con tooltip) para tarjetas y listas.
 */
const PlayerStatusBadge = ({ status, compact = false, className = '' }) => {
  const info = getPlayerStatus(status);
  if (!info) return null;

  if (compact) {
    return (
      <span
        className={`inline-flex items-center flex-shrink-0 text-sm leading-none ${className}`}
        title={info.label}
        aria-label={info.label}
        role="img"
      >
        {info.icon}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${info.badge} ${className}`}>
      <span aria-hidden="true">{info.icon}</span>
      {info.label}
    </span>
  );
};

export default PlayerStatusBadge;
