import type { AppCtx } from "../types";
import { createScheduler, type SchedulerHandle, type SchedulerOptions } from "./service";

export type { RoutineNotification, SchedulerHandle, SchedulerOptions } from "./service";

/** The lead may pass `notify` (local notification only) and may cast the result to SchedulerHandle for checkNow/setNotify. */
export function createSchedulerService(ctx: AppCtx, options: SchedulerOptions = {}): SchedulerHandle {
  return createScheduler(ctx, options);
}
