import type { ProductReport } from "../workspace-data";

export interface ReportContext {
  productId: string;
  days: 7 | 30 | 90;
}
export function sameReportContext(a: ReportContext, b: ReportContext): boolean {
  return a.productId === b.productId && a.days === b.days;
}

// One mounted page owns this store. Selection invalidates synchronously, before
// effects run, so even an old 401 cannot navigate after the selection changes.
export function createReportSession(deps: {
  request: (context: ReportContext) => Promise<ProductReport>;
  unauthorized: () => void;
}) {
  const empty = (context: ReportContext) => ({
    context,
    report: null as ProductReport | null,
    loading: false,
    error: "",
  });
  let state = empty({ productId: "", days: 30 });
  let generation = 0;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<typeof state>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    select(context: ReportContext) {
      if (sameReportContext(context, state.context)) return;
      generation++;
      update(empty(context));
    },
    dispose() {
      generation++;
    },
    async request(context: ReportContext) {
      const ticket = ++generation;
      update({ ...empty(context), loading: true });
      try {
        const report = await deps.request(context);
        if (ticket !== generation) return;
        update({ report });
      } catch (cause) {
        if (ticket !== generation) return;
        if ((cause as { status?: number })?.status === 401) deps.unauthorized();
        else update({ error: "The product report could not be loaded. Try again." });
      } finally {
        if (ticket === generation) update({ loading: false });
      }
    },
  };
}
