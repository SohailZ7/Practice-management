import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { FeedbackError } from "@/lib/feedback/service";
import { addFeedbackImages } from "@/lib/feedback/images";

// POST multipart: one or more `image` files for an item the caller wrote. JSON in, JSON out (Desktop and tests use this; the web page uses the form action).
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  const form = await req.formData().catch(() => null);
  const files = (form?.getAll("image") ?? []).filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "Choose an image." }, { status: 400 });
  try {
    const n = await addFeedbackImages(user, params.id, files);
    return NextResponse.json({ ok: true, added: n });
  } catch (e) {
    if (e instanceof FeedbackError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
