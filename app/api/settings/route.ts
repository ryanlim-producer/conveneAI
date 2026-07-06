import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { getUserSettings, updateUserSettings, type UserSettings } from "@/lib/settings";
import { isValidDeepgramModel, isValidLlmModel } from "@/lib/models";

export const GET = withAuth(async (_req: NextRequest, { user }) => {
  return NextResponse.json(getUserSettings(user.userId));
});

export const PUT = withAuth(async (req: NextRequest, { user }) => {
  let body: Partial<UserSettings>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.deepgramModel !== undefined && !isValidDeepgramModel(body.deepgramModel)) {
    return NextResponse.json(
      { error: `Unknown Deepgram model: ${body.deepgramModel}` },
      { status: 400 },
    );
  }
  for (const field of ["actionsLlmModel", "chatbotLlmModel"] as const) {
    const value = body[field];
    if (value !== undefined && !isValidLlmModel(value)) {
      return NextResponse.json({ error: `Unknown LLM model: ${value}` }, { status: 400 });
    }
  }

  updateUserSettings(user.userId, {
    deepgramModel: body.deepgramModel,
    actionsLlmModel: body.actionsLlmModel,
    chatbotLlmModel: body.chatbotLlmModel,
  });
  return NextResponse.json({ updated: true });
});
