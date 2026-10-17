// Historical report dates must never determine login/session expiry.
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";

export function createPhase16ReportClock(timestamp, ActualDate = Date) {
  const anchor = ActualDate.parse(timestamp);
  assert.ok(Number.isFinite(anchor));
  const context = new AsyncLocalStorage();
  return {
    Date: class extends ActualDate {
      constructor(...args) {
        super(...(args.length ? args : [context.getStore() ? anchor : ActualDate.now()]));
      }
      static now() {
        return context.getStore() ? anchor : ActualDate.now();
      }
    },
    runRequest(url, callback) {
      return context.run(url?.split("?")[0] === "/report-data", callback);
    },
  };
}
