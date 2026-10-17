import type {
  AiCapability,
  AiCoachResponse,
  AiCoachResult,
  createGrowthTask,
} from "../workspace-data";

export interface CoachContext {
  productId: string;
  capability: AiCapability;
  taskId?: string;
  evidenceId?: string;
}
type Task = AiCoachResult["advice"]["tasks"][number];
interface CoachState {
  context: CoachContext;
  result: AiCoachResult | null;
  requesting: boolean;
  error: string;
  refusal: string;
  notice: string;
  savingTask: string;
  addedTaskTitles: string[];
}

export function coachContextKey(context: CoachContext): string {
  return JSON.stringify([
    context.productId,
    context.capability,
    context.taskId ?? "",
    context.evidenceId ?? "",
  ]);
}

// Owned by one mounted Coach page. No cross-user or global cache. Synchronous
// generations invalidate requests before React renders a changed selection.
export function createCoachSession(deps: {
  request: (context: CoachContext) => Promise<AiCoachResponse>;
  createTask: typeof createGrowthTask;
  unauthorized: () => void;
}) {
  const empty = (context: CoachContext): CoachState => ({
    context,
    result: null,
    requesting: false,
    error: "",
    refusal: "",
    notice: "",
    savingTask: "",
    addedTaskTitles: [],
  });
  let state = empty({ productId: "", capability: "NEXT_ACTION" });
  let generation = 0;
  const listeners = new Set<() => void>();
  // A failed HTTP call may still have committed. Do not automatically retry a
  // task save from this page; ask the user to inspect Tasks after ambiguity.
  const attemptedTasks = new Set<string>();
  const update = (patch: Partial<CoachState>) => {
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
    select(context: CoachContext) {
      if (coachContextKey(context) === coachContextKey(state.context)) return;
      generation++;
      update(empty(context));
    },
    dispose() {
      generation++;
    },
    async request() {
      const context = { ...state.context };
      if (!context.productId) return;
      const ticket = ++generation;
      update({
        result: null,
        requesting: true,
        error: "",
        refusal: "",
        notice: "",
        savingTask: "",
        addedTaskTitles: [],
      });
      try {
        const response = await deps.request(context);
        if (ticket !== generation) return;
        if ("outcome" in response) update({ refusal: response.message });
        else update({ result: response });
      } catch (cause) {
        if (ticket !== generation) return;
        if ((cause as { status?: number })?.status === 401) deps.unauthorized();
        update({
          error: cause instanceof Error ? cause.message : "Advice could not be generated.",
        });
      } finally {
        if (ticket === generation) update({ requesting: false });
      }
    },
    async addTask(task: Task) {
      if (
        state.context.capability !== "TASK_GENERATION" ||
        !state.result?.advice.tasks.includes(task) ||
        state.requesting ||
        state.savingTask
      )
        return;
      const context = state.context;
      const key = JSON.stringify([context.productId, task.title.trim().toLocaleLowerCase()]);
      if (attemptedTasks.has(key)) {
        update({
          notice: "This task save was already attempted. Check Tasks before creating another copy.",
        });
        return;
      }
      attemptedTasks.add(key);
      const ticket = generation;
      update({ savingTask: task.title, error: "", notice: "" });
      try {
        await deps.createTask({
          productId: context.productId,
          title: task.title,
          description: task.description,
          priority: task.priority,
          signalStrength: task.signalStrength,
          estimatedMinutes: task.estimatedMinutes,
          rewardCredits: 0,
        });
        if (ticket === generation)
          update({
            addedTaskTitles: [...state.addedTaskTitles, task.title],
            notice: "Task added to your list with zero reward. AI did not save it automatically.",
          });
      } catch {
        if (ticket === generation)
          update({
            error: "Task save could not be confirmed. Check Tasks before creating another copy.",
          });
      } finally {
        if (ticket === generation) update({ savingTask: "" });
      }
    },
  };
}
