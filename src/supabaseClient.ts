// Stub Supabase client — the actual backend is Convex.
// This exists only so that App.tsx and Settings.tsx imports don't break.
export const supabase = {
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
  },
  from: (_table: string) => ({
    select: (_cols?: string, opts?: { count?: string; head?: boolean }) => ({
      eq: (_col: string, _val: unknown) => ({
        single: async () => ({ data: null, error: null, count: 0 }),
        then: (r: (v: unknown) => void) => r({ data: null, error: null, count: 0 }),
      }),
      then: (r: (v: unknown) => void) => r({ data: null, error: null, count: 0 }),
    }),
    update: (_data: Record<string, unknown>) => ({
      eq: (_col: string, _val: unknown) => ({
        then: (r: (v: unknown) => void) => r({ data: null, error: null }),
      }),
    }),
  }),
};
