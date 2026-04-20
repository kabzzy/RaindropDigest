import { NextResponse } from "next/server";

type LLMProvider = "openai" | "gemini" | "xai";
type SummaryModel = string;

function getProvider(): LLMProvider {
  const provider = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (!provider) {
    throw new Error("Missing LLM_PROVIDER. Set LLM_PROVIDER in .env.local to `openai`, `gemini`, or `xai`.");
  }
  if (provider !== "openai" && provider !== "gemini" && provider !== "xai") {
    throw new Error("Invalid LLM_PROVIDER. Set LLM_PROVIDER in .env.local to `openai`, `gemini`, or `xai`.");
  }
  return provider;
}

function getModel(): SummaryModel {
  const model = process.env.LLM_MODEL?.trim();
  if (!model) {
    throw new Error("Missing LLM_MODEL. Set LLM_MODEL in .env.local to the model for your configured provider.");
  }
  return model;
}

export async function GET() {
  try {
    const provider = getProvider();
    const model = getModel();
    return NextResponse.json({
      provider,
      defaultModel: model,
      availableModels: [model]
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
