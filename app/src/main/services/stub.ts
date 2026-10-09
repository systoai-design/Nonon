/** Placeholder for a service nobody has built yet. Every method rejects loudly, so a missing piece can never pass for a working one. */
export function stub<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get(_t, prop) {
      if (prop === "then") return undefined;
      return () => {
        throw new Error(`${name}.${String(prop)} is not implemented yet`);
      };
    },
  });
}
