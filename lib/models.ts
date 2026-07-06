export interface ModelOption {
  value: string;
  label: string;
  description: string;
  recommended?: boolean;
}

export const DEEPGRAM_MODELS: ModelOption[] = [
  { value: "nova-3", label: "Nova-3", description: "Latest, best accuracy, multi-speaker meetings", recommended: true },
  { value: "nova-2", label: "Nova-2", description: "Filler word detection, broader niche languages" },
  { value: "nova-2-meeting", label: "Nova-2 Meeting", description: "Optimized for meeting transcription" },
  { value: "enhanced", label: "Enhanced", description: "Lower WER than Base, keyword boosting" },
  { value: "base", label: "Base", description: "High volume, good timestamps" },
  { value: "whisper-medium", label: "Whisper Cloud (Medium)", description: "OpenAI Whisper, rate-limited" },
];

export const LLM_MODELS: ModelOption[] = [
  { value: "deepseek/deepseek-r1", label: "DeepSeek R1", description: "Reasoning model, best for structured extraction", recommended: true },
  { value: "openai/gpt-4o", label: "GPT-4o", description: "Fast, good for chat" },
  { value: "anthropic/claude-sonnet-4-20250514", label: "Claude Sonnet 4", description: "Balanced, good for chat and extraction" },
  { value: "openai/gpt-4.1", label: "GPT-4.1", description: "Latest, strong reasoning" },
];

export function isValidDeepgramModel(value: string): boolean {
  return DEEPGRAM_MODELS.some((m) => m.value === value);
}

export function isValidLlmModel(value: string): boolean {
  return LLM_MODELS.some((m) => m.value === value);
}
