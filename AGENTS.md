<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:mandatory-validation -->
## MANDATORY POST-CHANGE VALIDATION

After any application-code change, the required validation sequence is:

1. `npx prisma generate`
2. `npx tsc --noEmit`
3. `npx eslint .`
4. `npm run build`
5. `git diff --check`
6. `git status --short`

These commands are the project standard and must be used in implementation reports, security reviews, verifier reports, and implementation contracts.

Do not replace this sequence with:

- `npm run lint`
- `npm run build` only
- Next.js build type-checking
- a shorter task-specific subset

A command may be marked N/A only when it is genuinely inapplicable, and the report must explain why. Do not silently omit required checks.

Do not introduce a new test framework merely to satisfy a small scoped task. Existing relevant tests must still be run when they exist.
<!-- END:mandatory-validation -->
