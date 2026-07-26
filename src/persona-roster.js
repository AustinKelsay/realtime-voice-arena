export const DEFAULT_PERSONA_ID = "sora-bennett";
const AUDITION_CUE = "Please introduce yourself, then tell me what makes a conversation enjoyable. Take your time and speak naturally.";

export const PERSONA_ROSTER = Object.freeze([
  Object.freeze({
    id: "sora-bennett",
    name: "Sora Bennett",
    voicePrompt: "NATF2.pt",
    summary: "Warm and composed",
    auditionCue: AUDITION_CUE,
  }),
  Object.freeze({
    id: "mira-vale",
    name: "Mira Vale",
    voicePrompt: "NATF0.pt",
    summary: "Clear and curious",
    auditionCue: AUDITION_CUE,
  }),
  Object.freeze({
    id: "tessa-rowan",
    name: "Tessa Rowan",
    voicePrompt: "NATF1.pt",
    summary: "Bright and easygoing",
    auditionCue: AUDITION_CUE,
  }),
  Object.freeze({
    id: "june-calder",
    name: "June Calder",
    voicePrompt: "NATF3.pt",
    summary: "Gentle and reflective",
    auditionCue: AUDITION_CUE,
  }),
  Object.freeze({
    id: "theo-mercer",
    name: "Theo Mercer",
    voicePrompt: "NATM0.pt",
    summary: "Relaxed and expressive",
    auditionCue: AUDITION_CUE,
  }),
  Object.freeze({
    id: "elias-stone",
    name: "Elias Stone",
    voicePrompt: "NATM1.pt",
    summary: "Calm and measured",
    auditionCue: AUDITION_CUE,
  }),
  Object.freeze({
    id: "rowan-pike",
    name: "Rowan Pike",
    voicePrompt: "NATM2.pt",
    summary: "Grounded and steady",
    auditionCue: AUDITION_CUE,
  }),
  Object.freeze({
    id: "miles-arden",
    name: "Miles Arden",
    voicePrompt: "NATM3.pt",
    summary: "Thoughtful and mellow",
    auditionCue: AUDITION_CUE,
  }),
  Object.freeze({
    id: "lina-park",
    name: "Lina Park",
    voicePrompt: "VARF0.pt",
    summary: "Lively and playful",
    auditionCue: AUDITION_CUE,
  }),
  Object.freeze({
    id: "amara-quinn",
    name: "Amara Quinn",
    voicePrompt: "VARF2.pt",
    summary: "Smooth and poised",
    auditionCue: AUDITION_CUE,
  }),
  Object.freeze({
    id: "nico-reyes",
    name: "Nico Reyes",
    voicePrompt: "VARM0.pt",
    summary: "Upbeat and friendly",
    auditionCue: AUDITION_CUE,
  }),
  Object.freeze({
    id: "otis-blake",
    name: "Otis Blake",
    voicePrompt: "VARM2.pt",
    summary: "Dry and understated",
    auditionCue: AUDITION_CUE,
  }),
]);

const PERSONA_BY_ID = new Map(PERSONA_ROSTER.map((persona) => [persona.id, persona]));

export function findPersona(personaId = DEFAULT_PERSONA_ID) {
  return PERSONA_BY_ID.get(personaId) ?? null;
}
