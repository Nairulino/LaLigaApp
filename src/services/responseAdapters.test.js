import { createAdaptMarketResponse } from './responseAdapters';

const teamsMap = new Map([
  ['1', { id: '1', name: 'Real Madrid', shortName: 'RMA', slug: 'real-madrid', badgeColor: 'rma.png', badgeWhite: 'rma-w.png' }],
  ['2', { id: '2', name: 'Sevilla', shortName: 'SEV', slug: 'sevilla', badgeColor: 'sev.png', badgeWhite: 'sev-w.png' }],
]);

const loader = () => Promise.resolve(teamsMap);
const adapt = createAdaptMarketResponse(loader);

describe('createAdaptMarketResponse', () => {
  test('rellena team desde teams-master cuando el playerMaster solo trae teamId', async () => {
    const res = await adapt({
      data: [
        { id: 'm1', salePrice: 5, playerMaster: { id: 10, nickname: 'X', teamId: 1 } },
      ],
    });
    expect(res.data[0].playerMaster.team).toMatchObject({
      id: '1',
      name: 'Real Madrid',
      badgeColor: 'rma.png',
    });
    // no toca el resto del item
    expect(res.data[0].salePrice).toBe(5);
  });

  test('respeta el team que ya venía y solo completa lo que falta', async () => {
    const res = await adapt({
      data: [
        { id: 'm2', playerMaster: { id: 11, team: { id: 2, name: 'Sevilla FC' } } },
      ],
    });
    expect(res.data[0].playerMaster.team.name).toBe('Sevilla FC'); // se conserva
    expect(res.data[0].playerMaster.team.badgeColor).toBe('sev.png'); // se completa
  });

  test('no hace nada si todos los playerMaster ya traen escudo', async () => {
    const input = {
      data: [{ id: 'm3', playerMaster: { id: 12, team: { id: 1, badgeColor: 'ya.png' } } }],
    };
    const res = await adapt(input);
    expect(res).toBe(input); // misma referencia: no reconstruye
  });

  test('soporta el envoltorio { elements: [...] }', async () => {
    const res = await adapt({
      data: { elements: [{ id: 'm4', playerMaster: { id: 13, teamId: 2 } }] },
    });
    expect(res.data.elements[0].playerMaster.team.name).toBe('Sevilla');
  });

  test('degrada con gracia si teams-master viene vacío', async () => {
    const adaptEmpty = createAdaptMarketResponse(() => Promise.resolve(new Map()));
    const input = { data: [{ id: 'm5', playerMaster: { id: 14, teamId: 1 } }] };
    const res = await adaptEmpty(input);
    expect(res).toBe(input);
  });

  test('deja intactos items sin playerMaster', async () => {
    const res = await adapt({ data: [{ id: 'm6', foo: 1, playerMaster: { id: 1, teamId: 1 } }, { id: 'm7' }] });
    expect(res.data[1]).toEqual({ id: 'm7' });
  });
});
