import { bullMqConnectionOptions } from "@enough/cache";
import { Queue } from "bullmq";

export const MAIN_QUEUE_NAME = "enough";

export function createMainQueue(): Queue {
  return new Queue(MAIN_QUEUE_NAME, {
    connection: bullMqConnectionOptions(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  });
}
