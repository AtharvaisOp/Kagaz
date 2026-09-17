import { describe, expect, it } from 'vitest';

import { createFormFieldId, createFormWidgetId } from './identity';

describe('form identities', () => {
  it('length-prefixes source and field parts so delimiter characters cannot collide', () => {
    expect(createFormFieldId('source|a', 'name')).not.toBe(
      createFormFieldId('source', 'a|name'),
    );
  });

  it('includes source and page in widget identities', () => {
    expect(createFormWidgetId('source-a', 0, 'widget')).not.toBe(
      createFormWidgetId('source-a', 1, 'widget'),
    );
    expect(createFormWidgetId('source-a', 0, 'widget')).not.toBe(
      createFormWidgetId('source-b', 0, 'widget'),
    );
  });
});
