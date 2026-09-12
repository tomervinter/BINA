# BINA — working notes for Claude

## Deploy policy

**Always deploy to production at the end of every task** (push to `main` on
GitHub, which triggers the Render deploy at https://bina-radar.onrender.com).
Do this automatically once a task's changes are committed and verified
locally — no need to ask first each time; this instruction is the standing
authorization.

Before pushing, verify locally first (start the dev server, exercise the
change via the browser tools, check for console/server errors).

### Prisma datasource toggle

`prisma/schema.prisma`'s `datasource db { provider = ... }` must be
`"postgresql"` in every commit that gets pushed (Render's build runs
`npx prisma db push` against Postgres). Local dev uses `"sqlite"` instead.

- If a task didn't touch `schema.prisma`, just don't stage/commit it —
  check `git show HEAD:prisma/schema.prisma` still says `postgresql` before
  pushing, and leave the local working-copy `sqlite` override alone.
- If a task *did* change the schema, edit it to `postgresql`, commit, push,
  confirm the Render deploy applied it, then switch it back to `sqlite`
  locally and re-run `npx prisma generate` (do not commit the revert).

### After pushing

Poll the live site for the new build (a distinctive string from the change,
via curl or the browser tools) before declaring the deploy done, then do a
quick functional check against production using the `verify-deploy@test.com`
test account (isolated tenant — never the user's real data).
