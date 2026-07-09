import { NextResponse } from "next/server";

export function apiError(error: unknown) {
  if (error instanceof Response) return error;

  const message = error instanceof Error ? error.message : "Unexpected error";
  return NextResponse.json({ error: message }, { status: 400 });
}
