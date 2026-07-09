import { apiError } from "@/lib/api";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { POST: launch } = await import("../launch/route");
  const session = await requireAdmin();
  const { id } = await context.params;
  const campaign = await prisma.campaign.findFirst({ where: { id, ownerId: session.user.id } });

  if (!campaign || campaign.status !== "paused") {
    return apiError(new Error("Only paused campaigns can be resumed."));
  }

  return launch(request, { params: Promise.resolve({ id }) });
}
