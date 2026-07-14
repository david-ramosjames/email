import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { syncBouncesForUser } from "@/lib/bounces";
import { requireAdmin } from "@/lib/session";

export async function POST() {
  try {
    const session = await requireAdmin();
    const result = await syncBouncesForUser(session.user.id);

    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
