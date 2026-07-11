// Built-in, versioned content for the three parent-signature consent forms.
// This is the single source of truth for the full Hebrew form text - Stage 1
// has no admin template editor and no DB-stored form content on purpose (see
// the audit: a code-reviewed, git-tracked content module is the safest place
// for a legal-consent document's exact wording).
//
// Source documents (converted from the original .doc/.docx files supplied
// for this feature, full text preserved - no paragraph summarized, omitted,
// or replaced with placeholder text):
//   - "הוראות בטיחות על נייר קורס.doc"                                  -> SAFETY_INSTRUCTIONS
//   - "כתב הסכמת הורים להתנסויות לונג 2026.doc"                        -> LUNGE_CONSENT
//   - "כתב הסכמה להשתתפות בהתנסויות קבוצתי קורס מדריכים 2026.docx"      -> BEGINNER_LESSON_CONSENT
//
// Versioning: each exported content object is named/suffixed `_V1` and its
// `formVersion` field is the matching string ("v1"). A
// TeachingPracticeSignedForm.formVersion always points at one of these
// entries. Once any signed record references a version, that version's text
// must never be edited in place - add a new `_V2` object (and a new entry in
// FORM_CONTENT_REGISTRY) instead, so old signatures stay reproducible
// exactly as the parent saw them.
//
// LUNGE_CONSENT and BEGINNER_LESSON_CONSENT are ~90% the same template (the
// audit confirmed this) - built here from one shared builder
// (buildConsentFormContent) parameterized by the handful of sentences that
// actually differ between the two, rather than duplicated verbatim, so the
// two can't silently drift out of sync on the shared wording while still
// each preserving their own exact, correct text.

import type { ParentSignatureFormContent, ParentSignatureFormTypeValue } from "@/lib/parent-signatures/types";

const CONSENT_SHARED_TITLE = "פרטים כלליים וכתב הסכמה להשתתפות בהתנסויות";
const CONSENT_SHARED_SUBTITLE = "קורס מדריכים 2026";

const CONSENT_SHARED_INTRO_ABOUT_US =
  'קצת עלינו: חוות דאבל קיי פועלת במושב שרונה מזה 20 שנים ומתמחה באימון והדרכת רכיבה מערבית ורכיבה טיפולית. ' +
  "לאורך השנה פועל בחווה בית ספר לרכיבה לילדים בגילאי 6-99. לחווה נבחרת נוער אשר משתתפת בתחרויות רכיבה ארציות. " +
  "בחופשים מקיימת החווה קייטנות ומחנות רכיבה מרוכזים. כמו כן, ";

const CONSENT_SHARED_INTRO_ABOUT_US_TAIL = " אתם מוזמנים להישאר אתנו ולקחת חלק בפעילויות החווה השונות!";

const CONSENT_SHARED_COURSE_INTRO =
  'קצת על קורס המדריכים: אנו מקיימים בחוות "דאבל קיי" קורס מדריכים, אשר מכשיר את מיטב מדריכי הרכיבה בארץ. ' +
  'הקורס מאושר ע"י ההתאחדות הלאומית לספורט הרכיבה ומנהל הספורט. ' +
  "כחלק מתהליך הכשרתם, נדרשים חניכי הקורס להדריך רוכבים מתחילים. הכשרה זו כוללת כתיבת מערכי שעור והעברתם, " +
  "הדרכות פרטניות וקבוצתיות, שיח ותקשורת עם הורי התלמידים ועוד. " +
  "מטרת חניכי הקורס היא ליצור תהליך לימודי עם ילדכם/ ילדתכם, כך שתוך 6 שעורים הם יהיו מסוגלים לרכב במגרש " +
  "באופן עצמאי ולבצע מספר תרגילי רכיבה בסיסיים.";

const CONSENT_SHARED_CLOSING_INSTRUCTIONS = "יש להגיע בלבוש רכיבה - מכנס ארוך ונעליים סגורות.";

const CONSENT_SHARED_INTRO_HEADING = "אנא מלאו את הפרטים הבאים וחתמו על כתב ההסכמה:";

const CONSENT_SHARED_FIELDS: ParentSignatureFormContent["fields"] = [
  { key: "childName", label: "שם הילד (הרוכב)", required: true },
  { key: "childAge", label: "גיל", required: true },
  { key: "address", label: "כתובת", required: true },
  { key: "parentName", label: "שם ההורה", required: true },
  { key: "parentPhone", label: "טלפון", required: true },
  { key: "parentEmail", label: "כתובת מייל", required: true },
];

const CONSENT_SHARED_CONSENT_STATEMENTS: ParentSignatureFormContent["consentStatements"] = [
  {
    key: "participationConsent",
    text: "אני מאשר כי קראתי את הפרטים ומסכים שבני/ בתי ישתתף בהתנסויות הרכיבה בקורס המדריכים.",
    responseType: "ACKNOWLEDGMENT",
  },
  {
    key: "attendanceCommitment",
    text: "אני מתחייב להגעת בני/ בתי לכל ששת שעורי הרכיבה כמתחייב.",
    responseType: "ACKNOWLEDGMENT",
  },
  {
    key: "photoConsent",
    text: "אני מסכים/ לא מסכים שתמונות בני יעלו לאלבום קורס המדריכים בפייסבוק.",
    responseType: "YES_NO",
  },
];

function buildConsentFormContent(params: {
  formType: ParentSignatureFormTypeValue;
  greetingVerb: string; // "הרכיבה" (LUNGE) vs "ברכיבה" (BEGINNER) - exact source wording differs here
  aboutUsTherapySentence: string;
  lessonMixParagraph: string;
  weeksSummarySentence: string;
}): ParentSignatureFormContent {
  return {
    formType: params.formType,
    formVersion: "v1",
    title: `${CONSENT_SHARED_TITLE}\n${CONSENT_SHARED_SUBTITLE}`,
    introSections: [
      {
        paragraphs: [`ברוכים הבאים להתנסויות ${params.greetingVerb}, קורס מדריכים 2026!`],
      },
      {
        paragraphs: [
          CONSENT_SHARED_INTRO_ABOUT_US + params.aboutUsTherapySentence + CONSENT_SHARED_INTRO_ABOUT_US_TAIL,
        ],
      },
      {
        paragraphs: [CONSENT_SHARED_COURSE_INTRO],
      },
      {
        paragraphs: [params.lessonMixParagraph],
      },
      {
        paragraphs: [
          `לסיכום: ${params.weeksSummarySentence} נוכחותו קריטית להצלחת חניך הקורס במבחן ההסמכה. כל ההתנסויות בפיקוח מדריכי החווה המוסמכים.`,
          CONSENT_SHARED_CLOSING_INSTRUCTIONS,
        ],
      },
      {
        paragraphs: [CONSENT_SHARED_INTRO_HEADING],
      },
    ],
    fields: CONSENT_SHARED_FIELDS,
    consentStatements: CONSENT_SHARED_CONSENT_STATEMENTS,
    signerLabel: "שם ההורה",
    dateLabel: "תאריך",
  };
}

// "כתב הסכמת הורים להתנסויות לונג 2026.doc" - full text preserved.
export const LUNGE_CONSENT_CONTENT_V1: ParentSignatureFormContent = buildConsentFormContent({
  formType: "LUNGE_CONSENT",
  greetingVerb: "הרכיבה",
  aboutUsTherapySentence:
    "בחוות דאבל קיי מערך טיפולי הכולל רכיבה טיפולית פרטנית וקבוצתית במסגרות שיקומיות, ועוד.",
  lessonMixParagraph:
    "לצורך כך, ילדכם יקבל שישה שעורי רכיבה פרטניים (בני חצי שעה). השיעור האחרון והשישי, יהיה מבחן ההסמכה " +
    "של חניך הקורס וינכחו בו בוחנים חיצוניים מטעם ההתאחדות הלאומית לספורט הרכיבה.",
  weeksSummarySentence: "ילדכם יקבל שישה שעורי רכיבה בששת השבועות הקרובים.",
});

// "כתב הסכמה להשתתפות בהתנסויות קבוצתי קורס מדריכים 2026.docx" - full text
// preserved.
export const BEGINNER_LESSON_CONSENT_CONTENT_V1: ParentSignatureFormContent = buildConsentFormContent({
  formType: "BEGINNER_LESSON_CONSENT",
  greetingVerb: "ברכיבה",
  aboutUsTherapySentence:
    'בחוות דאבל קיי מערך טיפולי רחב הכולל רכיבה טיפולית, טיפול רגשי הנעזר בבע"ח, הדרכות הורים ע"י פסיכולוגית חינוכית ועוד.',
  lessonMixParagraph:
    "לצורך כך, ילדכם יקבל שני שעורי רכיבה פרטניים (בני חצי שעה) ושלושה שעורי רכיבה קבוצתיים (שעה). השיעור " +
    "האחרון והשישי, יהיה מבחן ההסמכה של חניך הקורס וינכחו בו בוחנים חיצוניים מטעם ההתאחדות הלאומית לספורט הרכיבה.",
  weeksSummarySentence: "ילדכם יקבל שישה שעורי רכיבה בארבעת השבועות הקרובים.",
});

// "הוראות בטיחות על נייר קורס.doc" - full text preserved.
export const SAFETY_INSTRUCTIONS_CONTENT_V1: ParentSignatureFormContent = {
  formType: "SAFETY_INSTRUCTIONS",
  formVersion: "v1",
  title: "הוראות בטיחות",
  introSections: [
    {
      paragraphs: [
        "ברוכים הבאים לחוות דאבל קיי,",
        "כמה דברים שצריך לשים לב אליהם כשנמצאים באורווה:",
      ],
    },
    {
      bullets: [
        "יש להישמע להוראות המדריכים.",
        "אסור לרוץ, להשתולל או לצעוק - זה מפחיד את הסוסים (וגם קצת אותנו...)",
        "אין להאכיל את הסוסים",
        "אין להתקרב לסוסים בתוך התאים או מחוץ להם בלי מדריך.",
        "אין להיכנס לתאים או למגרש בלי מדריך.",
        "אין להסתובב ליד הסוסים ללא נעליים סגורות.",
        "רוכבים מתחת לגיל 18 חייבים לחבוש קסדה בזמן הרכיבה",
      ],
    },
    {
      paragraphs: ["ספורט הרכיבה על סוסים הוא ספורט מסוכן מטבעו."],
    },
  ],
  fields: [
    { key: "medicalNotes", label: "אם ידוע על בעיות רפואיות מיוחדות אנא פרטו", required: false },
    { key: "riderName", label: "שם הרוכב", required: true },
    { key: "parentName", label: "שם ההורה (לתלמיד מתחת לגיל 18)", required: false },
  ],
  consentStatements: [
    {
      key: "safetyAcknowledgment",
      text: "אני, החתום מטה קראתי והבנתי את הוראות הבטיחות ואני מתחייב/ת למלא אחריהן.",
      responseType: "ACKNOWLEDGMENT",
    },
  ],
  signerLabel: "שם הרוכב / שם ההורה",
  dateLabel: "תאריך",
};

export const FORM_CONTENT_REGISTRY: Record<ParentSignatureFormTypeValue, Record<string, ParentSignatureFormContent>> = {
  SAFETY_INSTRUCTIONS: { v1: SAFETY_INSTRUCTIONS_CONTENT_V1 },
  LUNGE_CONSENT: { v1: LUNGE_CONSENT_CONTENT_V1 },
  BEGINNER_LESSON_CONSENT: { v1: BEGINNER_LESSON_CONSENT_CONTENT_V1 },
};

// The version every new signature should be created against. A future stage
// bumps this (and adds the corresponding _V2 object + registry entry) when
// the farm updates a form's wording; existing signed records keep pointing
// at their original version via TeachingPracticeSignedForm.formVersion.
export const CURRENT_FORM_VERSION: Record<ParentSignatureFormTypeValue, string> = {
  SAFETY_INSTRUCTIONS: "v1",
  LUNGE_CONSENT: "v1",
  BEGINNER_LESSON_CONSENT: "v1",
};

export function getFormContent(
  formType: ParentSignatureFormTypeValue,
  formVersion: string
): ParentSignatureFormContent | null {
  return FORM_CONTENT_REGISTRY[formType]?.[formVersion] ?? null;
}
