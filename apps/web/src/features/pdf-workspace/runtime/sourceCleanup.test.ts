import { describe, expect, it, vi } from 'vitest';

import { destroyRemovedSources } from './sourceCleanup';

describe('destroyRemovedSources', () => {
  it('destroys each source removed from committed state exactly once', () => {
    const destroySource = vi.fn().mockResolvedValue(undefined);

    destroyRemovedSources(
      { destroySource },
      ['source-a', 'source-b'],
      ['source-a'],
    );

    expect(destroySource).toHaveBeenCalledTimes(1);
    expect(destroySource).toHaveBeenCalledWith('source-b');
  });

  it('keeps a source that is still referenced by committed pages', () => {
    const destroySource = vi.fn().mockResolvedValue(undefined);

    destroyRemovedSources(
      { destroySource },
      ['source-a', 'source-b'],
      ['source-a', 'source-b'],
    );

    expect(destroySource).not.toHaveBeenCalled();
  });

  it('cleans a source once when a rapid sequence reaches final removal', () => {
    const destroySource = vi.fn().mockResolvedValue(undefined);

    destroyRemovedSources(
      { destroySource },
      ['source-a', 'source-b'],
      ['source-a', 'source-b'],
    );
    destroyRemovedSources(
      { destroySource },
      ['source-a', 'source-b'],
      ['source-a'],
    );

    expect(destroySource).toHaveBeenCalledTimes(1);
    expect(destroySource).toHaveBeenCalledWith('source-b');
  });
});
