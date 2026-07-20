import { callLLM } from "@/lib/llm-client";

export interface ActionItem {
  task: string;
  assignee: string;
  deadline: string;
  context: string;
  completed?: boolean;
}

export async function extractActionItems(
  userId: string,
  transcript: string,
  speakerMap: Record<string, string>,
  model = "deepseek/deepseek-r1",
): Promise<ActionItem[]> {
  const speakerContext = Object.entries(speakerMap)
    .map(([id, name]) => `${id} = ${name}`)
    .join(", ");

  const prompt = `You are analyzing a business meeting transcript (it may be in any language). Your task is to extract action items — specific tasks, commitments, or follow-ups that were assigned or agreed upon during the conversation.

${speakerContext ? `Speaker mapping: ${speakerContext}` : ""}

Transcript:
${transcript}

Return ONLY a JSON array of action items. Each item must have these fields:
- task (required): the specific action to be taken
- assignee: who is responsible (use the speaker's real name if known from the mapping)
- deadline: when it's due (e.g., "Friday", "next week", "end of month")
- context: brief context about why or where this was discussed

Format: [{"task": "...", "assignee": "...", "deadline": "...", "context": "..."}]

If no action items are found, return an empty array: []`;

  try {
    const response = await callLLM(userId, {
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 2000,
    });

    // Extract JSON from response (may be wrapped in markdown code block)
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);

    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (item): item is ActionItem =>
        typeof item === "object" &&
        item !== null &&
        typeof item.task === "string" &&
        item.task.trim().length > 0,
    ).map((item) => ({
      task: item.task?.trim() ?? "",
      assignee: item.assignee?.trim() ?? "",
      deadline: item.deadline?.trim() ?? "",
      context: item.context?.trim() ?? "",
    }));
  } catch {
    return [];
  }
}
