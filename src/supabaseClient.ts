/**
 * Safe Supabase client stub.
 *
 * NChat's backend is Convex — core features (auth, chat, friends, groups,
 * calls, media) are bridged to Convex via src/services/*. The remaining
 * optional services (statuses, privacy prefs, push notifications) still
 * import this module, so it must never throw at import time. All calls
 * resolve with empty results so those features degrade gracefully.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;

const emptyResult = (): AnyObj => ({ data: null, error: null, count: 0 });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chainable(): AnyObj {
  const promise = Promise.resolve(emptyResult());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: AnyObj = {
    select: (_cols?: unknown, _opts?: unknown) => obj,
    eq: (_col?: unknown, _val?: unknown) => obj,
    neq: (_col?: unknown, _val?: unknown) => obj,
    in: (_col?: unknown, _vals?: unknown) => obj,
    or: (_expr?: unknown) => obj,
    not: (_col?: unknown, _op?: unknown, _val?: unknown) => obj,
    order: (_col?: unknown, _opts?: unknown) => obj,
    limit: (_n?: unknown) => obj,
    range: (_a?: unknown, _b?: unknown) => obj,
    single: () => promise,
    maybeSingle: () => promise,
    upsert: (_data?: unknown, _opts?: unknown) => obj,
    insert: (_data?: unknown, _opts?: unknown) => obj,
    update: (_data?: unknown, _opts?: unknown) => obj,
    delete: (_opts?: unknown) => obj,
    then: (
      resolve?: (v: AnyObj) => void,
      reject?: (e: unknown) => void
    ) => promise.then(resolve, reject),
    catch: (reject?: (e: unknown) => void) => promise.catch(reject),
  };
  return obj;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase: AnyObj = {
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    getUser: async () => ({ data: { user: null }, error: null }),
    signUp: async () => ({ data: { user: null, session: null }, error: null }),
    signInWithPassword: async () => ({
      data: { user: null, session: null },
      error: null,
    }),
    signOut: async () => ({ error: null }),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onAuthStateChange: (_cb?: unknown) => ({
      data: { subscription: { unsubscribe: () => {} } },
    }),
  },
  from: (_table: string) => chainable(),
  rpc: (_fn?: string, _params?: unknown) => chainable(),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  channel: (_name?: string) => {
    const ch: AnyObj = {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      on: (_type?: unknown, _filter?: unknown, _cb?: unknown) => ch,
      subscribe: (_cb?: unknown) => ({ unsubscribe: () => {}, state: 'closed' }),
      unsubscribe: () => {},
      send: () => {},
      track: () => {},
      untrack: () => {},
      presenceState: () => ({}),
    };
    return ch;
  },
  removeChannel: (_channel?: unknown) => {},
  removeAllChannels: () => {},
};
