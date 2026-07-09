import { Queue, type ConnectionOptions } from "bullmq";

export const SEND_QUEUE_NAME = "referral-outreach-send";

export type SendJobData = {
  campaignRecipientId: string;
};

export function redisConnection(): ConnectionOptions {
  const url = new URL(process.env.REDIS_URL || "redis://localhost:6379");

  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  } as ConnectionOptions;
}

export function sendQueue() {
  return new Queue<SendJobData>(SEND_QUEUE_NAME, {
    connection: redisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: 500,
      removeOnFail: 1_000,
    },
  });
}

export function jobDelayForIndex(index: number, throttlePerHour: number) {
  const intervalMs = Math.ceil(3_600_000 / Math.max(1, throttlePerHour));
  return index * intervalMs;
}
