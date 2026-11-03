import React from 'react';
import useCountdown from '../../hooks/useCountdown';
import { formatCountdown } from '../../utils/helpers';

/**
 * Countdown — texto de cuenta atrás "2d 05:12:09" que se actualiza cada
 * segundo. Aislado en su propio componente para que el tick solo re-renderice
 * este texto y no la tarjeta entera. Al vencer pinta `fallback`.
 */
const Countdown = ({ endTime, fallback = null, className }) => {
  const countdown = useCountdown(endTime);
  const text = countdown.isOpen ? fallback : formatCountdown(countdown);
  if (text === null || text === undefined) return null;
  return <span className={className ? `tabular-nums ${className}` : 'tabular-nums'}>{text}</span>;
};

export default Countdown;
