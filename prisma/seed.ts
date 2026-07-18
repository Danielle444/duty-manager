import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const STUDENT_NAMES = [
  "נועה כהן",
  "איתי לוי",
  "שירה מזרחי",
  "יונתן פרץ",
  "מאיה ביטון",
  "עומר אזולאי",
  "רוני דהן",
  "תמר אוחיון",
  "דניאל אברהם",
  "הילה גבאי",
  "אורי שלום",
  "ליאור מלכה",
  "עדי בן דוד",
  "טל חדד",
  "יעל סבן",
  "אלון נחום",
  "שי עמר",
  "רותם ואקנין",
  "נטע פרידמן",
  "עידן קורן",
  "ליה אשכנזי",
  "אביב טל",
  "גל חג'ג'",
  "קרן זוהר",
  "עמית רוזן",
  "נעם דיין",
  "שקד יוסף",
  "בר כץ",
  "יובל אבידן",
  "מיכל צור",
  "רועי אלבז",
  "אור שושן",
  "דנה נסים",
  "אסף פינטו",
  "ענבל שמעוני",
  "נדב ברק",
  "שני מור",
  "איל בוזגלו",
  "הדר עידן",
  "תום גולן",
  "זיו מלר",
];

const DUTY_TYPES = [
  {
    name: "תורנות מים סוסים",
    description: "מילוי דליי מים לסוסים בבוקר ובערב ובדיקת תקינות המתקנים.",
    defaultRequiredCount: 4,
  },
  {
    name: "מתחם תאים",
    description: "ניקיון וסידור מתחם התאים, פיזור קש/נסורת.",
    defaultRequiredCount: 3,
  },
  {
    name: "חיסול ארוחת ערב",
    description: "פינוי כלים, ניקוי שולחנות וסידור חדר האוכל לאחר ארוחת הערב.",
    defaultRequiredCount: 2,
  },
  {
    name: "תורנות מזון סוסים",
    description: "הכנת וחלוקת מנות המזון לסוסים לפי לוח ההזנה.",
    defaultRequiredCount: 3,
  },
  {
    name: "תורנות ניקיון חצר",
    description: "טיאוט וסידור חצר הרפת ואזורי האימון.",
    defaultRequiredCount: 2,
  },
  {
    name: "חיסול א. צהריים",
    description: "פינוי וניקוי חדר האוכל לאחר ארוחת הצהריים.",
    defaultRequiredCount: 2,
  },
  {
    name: "בטיחות",
    description: "תורן/ית בטיחות אחד/ת מכל תת-קבוצה פעילה בכל יום.",
    defaultRequiredCount: 1,
    allocationMode: "ONE_PER_SUBGROUP" as const,
  },
];

const ADMIN_EMAILS = ["dkhorses@gmail.com", "showdoublek@gmail.com"];

function generateIdentityNumber(): string {
  return Math.floor(100_000_000 + Math.random() * 900_000_000).toString();
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

async function main() {
  console.log("מנקה נתונים קיימים...");
  await prisma.dutyAssignment.deleteMany();
  await prisma.studentAvailability.deleteMany();
  await prisma.scheduleItem.deleteMany();
  await prisma.dutyConstraint.deleteMany();
  await prisma.weeklySchedule.deleteMany();
  await prisma.courseDayPlan.deleteMany();
  await prisma.availabilityRangePreset.deleteMany();
  // COURSE-DATA GH1B - trainee history rows reference students with an
  // onDelete: Restrict FK, so they must be cleared before students.
  await prisma.traineeGroupMembership.deleteMany();
  await prisma.traineeHorseAssignment.deleteMany();
  await prisma.student.deleteMany();
  await prisma.dutyType.deleteMany();
  await prisma.courseSettings.deleteMany();
  await prisma.adminEmail.deleteMany();

  console.log("יוצר תלמידים...");
  const usedIdNumbers = new Set<string>();
  for (const [i, fullName] of STUDENT_NAMES.entries()) {
    const [firstName, ...rest] = fullName.split(" ");
    const lastName = rest.join(" ");

    let identityNumber = generateIdentityNumber();
    while (usedIdNumbers.has(identityNumber)) identityNumber = generateIdentityNumber();
    usedIdNumbers.add(identityNumber);

    await prisma.student.create({
      data: {
        firstName,
        lastName,
        fullName,
        identityNumber,
        groupName: i % 2 === 0 ? "א" : "ב",
        subgroupNumber: (i % 8) + 1,
        isActive: true,
      },
    });
  }

  console.log("יוצר סוגי תורנות...");
  const dutyTypesByName: Record<string, string> = {};
  for (const duty of DUTY_TYPES) {
    const created = await prisma.dutyType.create({ data: duty });
    dutyTypesByName[duty.name] = created.id;
  }

  const startDate = new Date(Date.UTC(2026, 6, 5)); // 2026-07-05 (Sunday)
  const endDate = addDays(startDate, 45); // ~1.5 months

  console.log("קובע תאריכי קורס...");
  await prisma.courseSettings.upsert({
    where: { id: 1 },
    update: { startDate, endDate },
    create: { id: 1, startDate, endDate },
  });

  console.log("יוצר פריסט זמינות לדוגמה...");
  await prisma.availabilityRangePreset.create({
    data: {
      name: "שבועיים ראשונים",
      startDate,
      endDate: addDays(startDate, 13),
    },
  });

  const secondCourseDay = addDays(startDate, 1);

  console.log("יוצר תכנון קבוצות יומי לדוגמה...");
  await prisma.courseDayPlan.create({
    data: {
      date: secondCourseDay,
      firstMorningGroup: "ב",
      secondMorningGroup: "א",
      firstAfterLunchGroup: "א",
      secondAfterLunchGroup: "ב",
    },
  });

  console.log("יוצר אילוץ שיבוץ לדוגמה...");
  await prisma.dutyConstraint.create({
    data: {
      dutyTypeId: dutyTypesByName["חיסול א. צהריים"],
      slot: "FIRST_AFTER_LUNCH",
      note: 'קבוצה שרוכבת ראשונה אחה"צ לא תשובץ לחיסול א. צהריים',
    },
  });

  console.log('יוצר לו"ז שבועי לדוגמה...');
  const weeklySchedule = await prisma.weeklySchedule.create({
    data: {
      name: "שבוע 1",
      startDate,
      endDate: addDays(startDate, 6),
      uploadedFileName: "seed-week-1.xlsx",
    },
  });

  await prisma.scheduleItem.createMany({
    data: [
      {
        weeklyScheduleId: weeklySchedule.id,
        date: startDate,
        startTime: "08:00",
        endTime: "09:00",
        title: "ארוחת בוקר",
        groupName: null,
        instructorName: null,
        location: "חדר אוכל",
      },
      {
        weeklyScheduleId: weeklySchedule.id,
        date: startDate,
        startTime: "09:00",
        endTime: "12:00",
        title: "רכיבה - שיעור בוקר",
        groupName: "ב",
        instructorName: "דנה כהן",
        location: "מגרש אימונים",
      },
      {
        weeklyScheduleId: weeklySchedule.id,
        date: startDate,
        startTime: "09:00",
        endTime: "12:00",
        title: "תיאוריה - אנטומיה של הסוס",
        groupName: "א",
        instructorName: "משה לוי",
        location: "כיתה",
      },
      {
        weeklyScheduleId: weeklySchedule.id,
        date: secondCourseDay,
        startTime: "14:00",
        endTime: "17:00",
        title: "רכיבה - שיעור אחר הצהריים",
        groupName: "א",
        instructorName: "דנה כהן",
        location: "מגרש אימונים",
      },
      {
        weeklyScheduleId: weeklySchedule.id,
        date: secondCourseDay,
        startTime: "14:00",
        endTime: "17:00",
        title: "סדנת חבישות",
        groupName: "ב",
        instructorName: "משה לוי",
        location: "מתחם תאים",
      },
      {
        weeklyScheduleId: weeklySchedule.id,
        date: secondCourseDay,
        startTime: "18:00",
        endTime: "19:00",
        title: "מפגש ערב משותף",
        groupName: null,
        instructorName: null,
        location: "חדר אוכל",
      },
    ],
  });

  console.log("יוצר מנהלים מורשים...");
  for (const email of ADMIN_EMAILS) {
    await prisma.adminEmail.create({ data: { email } });
  }

  console.log(
    "סיום. נוצרו",
    STUDENT_NAMES.length,
    "תלמידים,",
    DUTY_TYPES.length,
    "סוגי תורנות,",
    ADMIN_EMAILS.length,
    "מנהלים מורשים."
  );
  console.log(
    `טווח הקורס: ${startDate.toISOString().slice(0, 10)} עד ${endDate.toISOString().slice(0, 10)}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
