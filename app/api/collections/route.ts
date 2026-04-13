import { NextResponse } from "next/server";

function getBackendUrl() {
  return process.env.PYTHON_BACKEND_URL || "http://127.0.0.1:8000";
}

export async function GET() {
  try {
    const response = await fetch(`${getBackendUrl()}/api/collections`, {
      cache: "no-store"
    });
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
