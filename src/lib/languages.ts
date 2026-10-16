/** Languages offered for translation and read-aloud. `tts` is the Cloud Text-to-Speech language code. */
export const LANGUAGES = [
  { code: "en", tts: "en-IN", label: "English" },
  { code: "hi", tts: "hi-IN", label: "हिन्दी (Hindi)" },
  { code: "bn", tts: "bn-IN", label: "বাংলা (Bengali)" },
  { code: "ta", tts: "ta-IN", label: "தமிழ் (Tamil)" },
  { code: "te", tts: "te-IN", label: "తెలుగు (Telugu)" },
  { code: "mr", tts: "mr-IN", label: "मराठी (Marathi)" },
  { code: "gu", tts: "gu-IN", label: "ગુજરાતી (Gujarati)" },
  { code: "kn", tts: "kn-IN", label: "ಕನ್ನಡ (Kannada)" },
  { code: "ml", tts: "ml-IN", label: "മലയാളം (Malayalam)" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];
export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code) as [LanguageCode, ...LanguageCode[]];
export const ttsCode = (code: LanguageCode) => LANGUAGES.find((l) => l.code === code)!.tts;
