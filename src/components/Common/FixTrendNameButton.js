import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil } from 'lucide-react';
import Modal from './Modal';
import marketTrendsService from '../../services/marketTrendsService';
import { getTrendNameOverride, setTrendNameOverride } from '../../services/trendNameOverrides';

/**
 * FixTrendNameButton — enganche para que el propio usuario corrija, desde la
 * ficha de un jugador con "Sin datos de tendencia", el nombre con el que
 * buscar su tendencia en la fuente scrapeada (futbolfantasy.com). Se guarda
 * en localStorage (trendNameOverrides.js) y lo usa marketTrendsService en
 * toda la app a partir de ahí, sin tocar código ni esperar un redeploy.
 *
 * `onFixed` es responsabilidad del padre: como el trend no está en estado de
 * React, hace falta forzar un re-render local (p.ej. un contador en useState)
 * para que la tarjeta relea marketTrendsService y muestre el resultado ya.
 */
const FixTrendNameButton = ({ player, onFixed, className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [value, setValue] = useState('');

  const displayName = player?.nickname || player?.name;
  if (!displayName) return null;

  const openModal = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setValue(getTrendNameOverride(displayName) || '');
    setIsOpen(true);
  };

  const close = () => setIsOpen(false);

  const handleSave = () => {
    const trimmed = value.trim();
    if (!trimmed) return;

    setTrendNameOverride(displayName, trimmed);

    const found = marketTrendsService.resolveTrendForPlayer(player);
    if (found) {
      toast.success(`Ahora se encuentra la tendencia de ${displayName}`, { duration: 3000 });
    } else {
      toast(
        `Guardado, pero con "${trimmed}" sigue sin encontrarse. Revisa que sea el nombre exacto de futbolfantasy.com.`,
        { icon: '⚠️', duration: 5000 }
      );
    }

    close();
    onFixed?.();
  };

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        onMouseDown={(e) => e.preventDefault()}
        className={`inline-flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 hover:underline ${className}`}
      >
        <Pencil className="w-3 h-3" aria-hidden="true" />
        Corregir nombre
      </button>

      {isOpen && (
        <Modal isOpen={isOpen} onClose={close} className="p-6 mx-4">
          <div
            className="space-y-4"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              Corregir nombre para tendencias
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              LaLiga muestra a este jugador como <strong>{displayName}</strong>, pero la fuente de
              tendencias de mercado (futbolfantasy.com) puede usar otro nombre. Escribe el nombre
              exacto que usa esa web y lo recordaremos a partir de ahora — solo en este navegador.
            </p>
            <div>
              <label htmlFor="trend-name-override" className="sr-only">
                Nombre en futbolfantasy.com
              </label>
              <input
                id="trend-name-override"
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave();
                }}
                placeholder="Ej: Adrián de la Fuente"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:ring-primary-500 focus:border-primary-500"
                autoFocus
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={close} className="flex-1 btn-secondary">
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!value.trim()}
                className="flex-1 btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Guardar
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
};

export default FixTrendNameButton;
