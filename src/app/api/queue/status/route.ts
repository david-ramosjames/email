import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { sendQueue } from "@/lib/queue";
import { requireAdmin } from "@/lib/session";

export async function GET() {
  const queue = sendQueue();

  try {
    await requireAdmin();
    const [counts, workers] = await Promise.all([
      queue.getJobCounts("active", "completed", "delayed", "failed", "paused", "prioritized", "waiting", "waiting-children"),
      queue.getWorkers().catch(() => []),
    ]);

    return NextResponse.json({
      counts,
      workers: workers.map((worker) => ({
        id: worker.id,
        name: worker.name,
        addr: worker.addr,
      })),
    });
  } catch (error) {
    return apiError(error);
  } finally {
    await queue.close();
  }
}
