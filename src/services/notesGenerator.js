import { generateText } from "ai";
import { google } from "@ai-sdk/google";

// @ai-sdk/google reads GOOGLE_GENERATIVE_AI_API_KEY from the environment.

const SYSTEM = `You turn raw video transcripts into structured study notes.
Output ONLY GitHub-flavored Markdown, with no preamble or sign-off, in exactly this shape:

# <Descriptive Title>

## TL;DR
<2-3 sentence summary>

## Key Points
- 5 to 10 bullets of the most important takeaways

## Notes
### <Section heading per topic shift>
<detailed notes for the section. If transcript lines start with [mm:ss] markers,
begin each section with its starting timestamp in bold, e.g. **[04:12]**>

## Glossary
- **Term** — one-line definition (only for terms actually used; omit this entire section if there are none)

Rules: stay faithful to the transcript, never invent facts, and do not include any HTML.`;

// Generate markdown study notes from a (possibly timestamped) transcript.
export const generateNotes = async (transcript) => {
  const input = String(transcript || "").slice(0, 120000); // cost/context guard
  if (!input.trim()) throw new Error("Transcript was empty — nothing to summarize.");

  const { text } = await generateText({
    model: google("gemini-2.5-flash"),
    system: SYSTEM,
    prompt: `TRANSCRIPT:\n\n${input}`,
  });

  const notes = (text || "").trim();
  if (!notes) throw new Error("The notes generator returned nothing.");
  return notes;
};
