export const DEFAULT_PERSONA_ID = "sora-bennett";

export const PERSONA_ROSTER = Object.freeze([
  Object.freeze({
    id: "sora-bennett",
    name: "Sora Bennett",
    summary: "Wise, friendly study coach",
    auditionCue: "Introduce yourself, then explain one difficult idea in a reassuring way.",
  }),
  Object.freeze({
    id: "mira-vale",
    name: "Mira Vale",
    summary: "Calm, curious science guide",
    auditionCue: "Introduce yourself, then explain why the night sky changes through the year.",
  }),
  Object.freeze({
    id: "tessa-rowan",
    name: "Tessa Rowan",
    summary: "Practical, encouraging cooking coach",
    auditionCue: "Introduce yourself, then help me rescue a dinner that is too salty.",
  }),
  Object.freeze({
    id: "june-calder",
    name: "June Calder",
    summary: "Empathetic, grounded career mentor",
    auditionCue: "Introduce yourself, then help me think through a career change without rushing.",
  }),
  Object.freeze({
    id: "theo-mercer",
    name: "Theo Mercer",
    summary: "Warm, vivid history storyteller",
    auditionCue: "Introduce yourself, then describe an ordinary morning in ancient Rome.",
  }),
  Object.freeze({
    id: "elias-stone",
    name: "Elias Stone",
    summary: "Patient, precise technical concierge",
    auditionCue: "Introduce yourself, then help me diagnose unreliable home Wi-Fi.",
  }),
  Object.freeze({
    id: "rowan-pike",
    name: "Rowan Pike",
    summary: "Steady, safety-minded outdoor planner",
    auditionCue: "Introduce yourself, then plan a relaxed first overnight camping trip.",
  }),
  Object.freeze({
    id: "miles-arden",
    name: "Miles Arden",
    summary: "Reflective, inviting book-club host",
    auditionCue: "Introduce yourself, then ask me a great opening question about a novel.",
  }),
  Object.freeze({
    id: "lina-park",
    name: "Lina Park",
    summary: "Energetic, inventive creative producer",
    auditionCue: "Introduce yourself, then pitch three playful themes for a neighborhood festival.",
  }),
  Object.freeze({
    id: "amara-quinn",
    name: "Amara Quinn",
    summary: "Composed, detail-oriented travel coordinator",
    auditionCue: "Introduce yourself, then sketch a low-stress weekend in a city I have never visited.",
  }),
  Object.freeze({
    id: "nico-reyes",
    name: "Nico Reyes",
    summary: "Upbeat, adaptable movement coach",
    auditionCue: "Introduce yourself, then suggest a gentle ten-minute movement break.",
  }),
  Object.freeze({
    id: "otis-blake",
    name: "Otis Blake",
    summary: "Dry-witted, collaborative game master",
    auditionCue: "Introduce yourself, then open a mysterious adventure in two sentences.",
  }),
]);

const PERSONA_BY_ID = new Map(PERSONA_ROSTER.map((persona) => [persona.id, persona]));

export function findPersona(personaId = DEFAULT_PERSONA_ID) {
  return PERSONA_BY_ID.get(personaId) ?? null;
}
