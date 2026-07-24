export const DEFAULT_PERSONA_ID = "sora-bennett";
const AUDITION_CUE = "Please introduce yourself, then tell me what makes a conversation enjoyable. Take your time and speak naturally.";

export const PERSONA_ROSTER = Object.freeze([
  Object.freeze({
    id: "sora-bennett",
    name: "Sora Bennett",
    summary: "Warm and composed",
    auditionCue: AUDITION_CUE,
  }),
  Object.freeze({
    id: "mira-vale",
    name: "Mira Vale",
    summary: "Clear and curious",
    auditionCue: AUDITION_CUE,
  }),
  Object.freeze({
    id: "tessa-rowan",
    name: "Tessa Rowan",
    summary: "Bright and easygoing",
    auditionCue: AUDITION_CUE,
  }),
  Object.freeze({
    id: "june-calder",
    name: "June Calder",
    summary: "Gentle and reflective",
    auditionCue: AUDITION_CUE,
  }),
  Object.freeze({
    id: "theo-mercer",
    name: "Theo Mercer",
    summary: "Relaxed and expressive",
    auditionCue: AUDITION_CUE,
  }),
  Object.freeze({
    id: "elias-stone",
    name: "Elias Stone",
    summary: "Calm and measured",
    auditionCue: AUDITION_CUE,
  }),
  Object.freeze({
    id: "rowan-pike",
    name: "Rowan Pike",
    summary: "Grounded and steady",
    auditionCue: AUDITION_CUE,
  }),
  Object.freeze({
    id: "miles-arden",
    name: "Miles Arden",
    summary: "Thoughtful and mellow",
    auditionCue: AUDITION_CUE,
  }),
  Object.freeze({
    id: "lina-park",
    name: "Lina Park",
    summary: "Lively and playful",
    auditionCue: AUDITION_CUE,
  }),
  Object.freeze({
    id: "amara-quinn",
    name: "Amara Quinn",
    summary: "Smooth and poised",
    auditionCue: AUDITION_CUE,
  }),
  Object.freeze({
    id: "nico-reyes",
    name: "Nico Reyes",
    summary: "Upbeat and friendly",
    auditionCue: AUDITION_CUE,
  }),
  Object.freeze({
    id: "otis-blake",
    name: "Otis Blake",
    summary: "Dry and understated",
    auditionCue: AUDITION_CUE,
  }),
]);

const PERSONA_BY_ID = new Map(PERSONA_ROSTER.map((persona) => [persona.id, persona]));

export function findPersona(personaId = DEFAULT_PERSONA_ID) {
  return PERSONA_BY_ID.get(personaId) ?? null;
}
