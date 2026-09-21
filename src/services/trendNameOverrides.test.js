import {
  getTrendNameOverride,
  setTrendNameOverride,
  removeTrendNameOverride,
  getAllTrendNameOverrides,
} from './trendNameOverrides';

describe('trendNameOverrides', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('no hay alias por defecto', () => {
    expect(getTrendNameOverride('Dela')).toBeNull();
  });

  test('guarda y recupera un alias, normalizando la clave (acentos/mayúsculas)', () => {
    setTrendNameOverride('Dela', 'Adrián de la Fuente');
    expect(getTrendNameOverride('Dela')).toBe('Adrián de la Fuente');
    expect(getTrendNameOverride('dela')).toBe('Adrián de la Fuente');
    expect(getTrendNameOverride('DÉLA')).toBe('Adrián de la Fuente');
  });

  test('sobrescribe un alias existente', () => {
    setTrendNameOverride('Dela', 'Adrián de la Fuente');
    setTrendNameOverride('Dela', 'Otro Nombre');
    expect(getTrendNameOverride('Dela')).toBe('Otro Nombre');
  });

  test('ignora guardar sin nombre o sin valor', () => {
    setTrendNameOverride('', 'Algo');
    setTrendNameOverride('Dela', '   ');
    expect(getAllTrendNameOverrides()).toEqual({});
  });

  test('elimina un alias', () => {
    setTrendNameOverride('Dela', 'Adrián de la Fuente');
    removeTrendNameOverride('Dela');
    expect(getTrendNameOverride('Dela')).toBeNull();
  });

  test('sobrevive a un localStorage con JSON corrupto', () => {
    localStorage.setItem('laliga_trend_name_overrides', '{not json');
    expect(getTrendNameOverride('Dela')).toBeNull();
    setTrendNameOverride('Dela', 'Adrián de la Fuente');
    expect(getTrendNameOverride('Dela')).toBe('Adrián de la Fuente');
  });
});
