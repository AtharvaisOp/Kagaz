export type IdFactory<T extends string = string> = () => T;

export function createBrowserIdFactory(prefix: string): IdFactory<string> {
  return () => {
    const cryptoApi = globalThis.crypto;
    if (typeof cryptoApi?.randomUUID === 'function') {
      return `${prefix}-${cryptoApi.randomUUID()}`;
    }

    if (typeof cryptoApi?.getRandomValues === 'function') {
      const values = cryptoApi.getRandomValues(new Uint32Array(4));
      return `${prefix}-${Array.from(values)
        .map((value) => value.toString(16).padStart(8, '0'))
        .join('')}`;
    }

    throw new Error('Secure browser ID generation is unavailable.');
  };
}
