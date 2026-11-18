import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { clearAllMaps, countMaps, loadMap, saveMap } from '../src/keymap';

describe('key map store (IndexedDB)', () => {
  it('saves, loads per thread and clears', async () => {
    await saveMap('t1', { '[NAME_1]': 'Priya Raghavan' });
    await saveMap('t2', { '[PHONE_1]': '07700 900461' });
    expect(await loadMap('t1')).toEqual({ '[NAME_1]': 'Priya Raghavan' });
    expect(await loadMap('missing')).toEqual({});
    expect(await countMaps()).toBe(2);
    await clearAllMaps();
    expect(await countMaps()).toBe(0);
  });
});
