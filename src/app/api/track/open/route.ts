import { EmailEventType } from "@prisma/client";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyOpenTrackingToken } from "@/lib/tracking";

const transparentGif = Buffer.from("R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==", "base64");

function pixelResponse() {
  return new Response(transparentGif, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

export async function GET(request: NextRequest) {
  const campaignRecipientId = request.nextUrl.searchParams.get("cr") || "";
  const token = request.nextUrl.searchParams.get("t") || "";

  try {
    if (!campaignRecipientId || !token || !verifyOpenTrackingToken(campaignRecipientId, token)) {
      return pixelResponse();
    }

    const campaignRecipient = await prisma.campaignRecipient.findUnique({
      where: { id: campaignRecipientId },
      select: { id: true, campaignId: true },
    });

    if (!campaignRecipient) return pixelResponse();

    await prisma.emailEvent.create({
      data: {
        campaignId: campaignRecipient.campaignId,
        campaignRecipientId: campaignRecipient.id,
        type: EmailEventType.opened,
        metadata: {
          userAgent: request.headers.get("user-agent"),
        },
      },
    });
  } catch (error) {
    console.error("Open tracking failed", error);
  }

  return pixelResponse();
}
