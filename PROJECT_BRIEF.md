# Project Brief: duty-manager ("Double K Top")

## 1. What it is
A Hebrew, right-to-left web app for running a ~6-week residential **horse-riding-instructor training course** at the Double K Top ranch (~41 trainees). It started as a daily **duty-roster (תורנות) scheduler** and has grown into the ranch's whole course-operations system: attendance, weekly schedule import, riding-lesson planning/feedback, teaching-practice (trainees teaching outside children) with role rotation, per-trainee progress journals, course materials, digital parent-consent signatures, and push notifications. The `README.md` (in Hebrew) is the authoritative feature description.

## 2. Users & workflows
Three distinct audiences, three auth models:
- **Admin (the course manager)** — every `/admin/*` page. Gated by Google OAuth (`auth.ts`) **and** an allowlist: only emails present-and-active in the `AdminEmail` table pass. Runs the whole course: imports students (Excel), duty types (Word), and the weekly schedule (Excel); generates/publishes duty rosters; marks attendance/completion; plans riding slots; manages teaching-practice tracks; writes progress feedback.
- **Trainee/student (`/student`)** — **no OAuth**. Logs in with name search + `identityNumber` (Israeli ID, doubles as password; only last 4 digits shown in admin tables). Sees today's duty, "my schedule", course booklet, messages/tasks, weekly feedback forms, teaching-practice assignments.
- **Instructor (`/instructor`)** — **no password**, just picks their name. View-everything by default; write access is per-capability via boolean flags on `Instructor` (`canEditAttendance`, `canEditRidingNotes`, `canSendMessages`, `canManageTeachingPracticeAssignments`, `canManageChildSignatures`, etc.). Instructors otherwise coordinate over WhatsApp (no per-instructor read tracking — see memory).

The scheduler produces **drafts** (`isPublished=false`); trainees never see a roster or weekly schedule until an admin explicitly publishes it.

## 3. Tech stack
- **Next.js 16.2** (App Router, RSC + server actions), **React 19**, **TypeScript 5**, **Tailwind CSS 4** (`@tailwindcss/postcss`).
- **Prisma 7** ORM (`@prisma/adapter-pg` + `pg`) against **PostgreSQL on Supabase**. Client is generated to `app/generated/prisma/` (not `node_modules`).
- **NextAuth/Auth.js v5 beta** (`next-auth`), Google provider only, JWT sessions.
- **Supabase Storage** (`@supabase/supabase-js`, service-role key, server-only) for private buckets: `course-booklets`, `course-materials`, `parent-signatures`.
- **web-push** (VAPID) for trainee push notifications; **exceljs** for Excel import/export; **zod** for validation; **tsx** for the seed.
- **Deploy target: Vercel**; DB migrations run separately (`prisma migrate deploy`). ~68k LOC of TS/TSX (excluding generated code).

## 4. Architecture & data flow
Server-component pages under `app/` fetch via **server actions in `lib/actions/*`** (~60 files, one per domain, mostly `"use server"`). Client components (`*Client.tsx`, `lib/components/*`) handle interactivity and call those actions. `proxy.ts` (Next.js middleware, matcher `/admin/:path*`) does an *optimistic* JWT-cookie check; the **authoritative** admin check is `requireAdmin()` in `lib/auth/require-admin.ts`, re-run on every admin page (React-`cache`d) so deactivating an admin takes effect immediately even with a live session. `lib/prisma.ts` is the singleton client; `lib/supabase.ts` wraps Storage.

The **duty scheduler** (`lib/scheduler.ts`) is the algorithmic core: per date it filters available/unassigned/unconstrained students, computes total slots = min(sum of duty-type required counts, available students), distributes proportionally by largest-remainder, and picks students by weighted score — **week-repeat (1,000,000) ≫ duty-overall-repeat (10,000) ≫ total-assignments/fairness (100) ≫ random tiebreak**. Three modes: `fillMissing`, `regeneratePreserveManual` (default), `clearAndRegenerate`. Constraints come from `CourseDayPlan` (which group rides in each of 4 daily slots) × `DutyConstraint`.

## 5. Directory map
- `app/admin/*` — admin pages (each folder: `page.tsx` server + `*Client.tsx` client). Key areas: `students`, `duties`, `availability`, `day-plan`, `weekly-schedule/[id]/riding`, `schedule`, `daily-tracking`, `teaching-practice`, `trainee-progress`, `weekly-feedback`, `parent-signatures`, `materials`, `messages`, `horses`, `instructors`, `admins`.
- `app/student/`, `app/instructor/` — the two public apps (section components + `*Client.tsx`).
- `app/api/*` — route handlers for uploads and Excel exports; `app/api/auth/[...nextauth]`.
- `app/generated/prisma/` — **generated Prisma client, do not edit**.
- `lib/actions/` — all server actions (business logic). `lib/components/` — shared client UI. `lib/*.ts` — pure helpers (`scheduler`, `dates`, `schedule-*`, `teaching-practice-*`, `horse-info`, `subgroup-identity`, `presentation-rubric`, `parent-signatures/`).
- `prisma/` — `schema.prisma` (1,828 lines, ~50 models), 41 timestamped `migrations/`, `seed.ts` (41 sample students, admin emails `dkhorses@gmail.com`/`showdoublek@gmail.com`).
- Root: `auth.ts`, `proxy.ts`, `AGENTS.md`/`CLAUDE.md`, PWA files in `public/` (`sw.js`, icons) + `app/manifest.ts`.

## 6. Key abstractions & conventions
- **"Presence of a row = feature active"** — no boolean flags: a `RidingSlot` row makes a `ScheduleItem` a riding slot; a `RidingSlotComplexPlan` row makes it "complex" mode; a `NoDutyDate` row skips duty generation.
- **Materialize-at-creation** — `MessageTaskRecipient`, `WeeklyFeedbackQuestion`, teaching-practice lessons, and all `*Publication*` tables snapshot data at creation; later edits to source rows never rewrite published/sent content. Publications track staleness via `version` vs `sourceVersion` (UNPUBLISHED/CURRENT/STALE).
- **Dual-actor identity** — because admins (NextAuth) and instructors (name-only) use different auth systems, "who touched this" is denormalized: `updatedByInstructorId` + `updatedByAdminEmail`/`updatedByAdminName` + a display `updatedByName`.
- **Soft delete** — `isActive` everywhere (Student/Instructor/DutyType/tracks); hard deletes are rare, so FKs to these use `onDelete: SetNull`, not Cascade.
- **Free-text-not-enum** for content that grows (`horseName` — no `Horse` model exists at all; `hayType`, `lessonTopic`, `section`). Ratings stored as **half-points (2–10 = 1.0–5.0)**, validated in the action layer, not the schema. Dates stored as `@db.Date` "naked" UTC to avoid timezone day-shift (`lib/dates.ts`).
- **Naming**: `page.tsx` (server) + `*Client.tsx` (client); server-action files are kebab-case per domain; Prisma `@@map`s snake_case tables.

## 7. Current state
Active, fast-moving, single-developer (Danielle444/dkhorses). **Zero TODO/FIXME/HACK markers** in source — instead, work is tracked as **named staged deliverables** documented in schema comments and commit messages: e.g. teaching-practice, `RIDING-PAIRS P1–P5a`, `RIDING-COMPLEX-PUBLICATION P7A–P7D` (P7D is the last remaining riding-complex stage per memory), `Stage I1/H2/N1`. Recent commits (last ~15) center on teaching-practice feedback UI, parent-signature revocation, and complex-riding publication. Schema often lands **ahead of UI** ("schema-only in this stage" is a recurring comment). Push notifications are trainee-only; instructor push/attendance/material push is future work (memory).

## 8. Constraints when touching this code
- **AGENTS.md**: "This is NOT the Next.js you know" — Next.js 16 has breaking changes; **read `node_modules/next/dist/docs/` before writing Next.js code**, heed deprecation notices.
- Excel/Word imports **never write directly** — always an editable preview + explicit confirm.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` / `VAPID_PRIVATE_KEY` client-side; Storage access is server-only; features degrade gracefully if env vars are missing.
- `/student` and `/instructor` are intentionally **un-OAuth'd** — don't "secure" them. `identityNumber` is not encryption (internal use only).
- Brand is **"Double K Top" only, never "Double K Ranch"** (README title is stale on this point — see memory).
- After changes: follow the mandatory post-change validation sequence defined in AGENTS.md.

## 9. Open questions / unresolved
- **No group-vs-day validation**: nothing checks that a teaching-practice track's `groupName` matches the actual A/B day pattern — caused a real 2026-07-19 "Group B" scheduling incident (memory). A known validation gap.
- **`RidingSlotAssignment.instructorId`** is legacy, kept in sync with the newer `RidingSlotAssignmentInstructor` join table during an incomplete migration — two sources of truth for "who instructs".
- **Complex-riding P2/P3** actions were being redesigned around the P5a station hierarchy; some schema exists without server actions.
- No dedicated Teaching-Practice **season/course model** — `CourseSettings` is a single global row; season boundaries are hacked via a `courseCycle` string (e.g. `"2026-summer"`) on signed forms.
- README's Hebrew title still says "Double K Ranch"; correct brand is "Double K Top".
