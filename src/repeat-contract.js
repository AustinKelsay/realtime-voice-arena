export const MAX_REPEAT_TEXT_CHARS = 800;

export function normalizeRepeatText(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    throw new Error(
      `Pasted text must contain between 1 and ${MAX_REPEAT_TEXT_CHARS} characters.`,
    );
  }
  if ([...text].length > MAX_REPEAT_TEXT_CHARS) {
    throw new RangeError(
      `Pasted text must contain between 1 and ${MAX_REPEAT_TEXT_CHARS} characters.`,
    );
  }
  return text;
}
