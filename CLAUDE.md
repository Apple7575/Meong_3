# 멍백홈 (MeongBackHome)

Location-based lost-dog rescue app. Expo (React Native, TypeScript) + Supabase (PostgreSQL/PostGIS, RLS, Edge Functions, Realtime, Storage) + FCM push. App-only reporting; walk feature drives density.

## Deploy Configuration (configured by /setup-deploy)
- Platform: **Supabase cloud** (backend) + **EAS/Expo** (mobile app) — no web PaaS, no auto-deploy-on-push
- Backend URL: `https://<PROJECT_REF>.supabase.co`  *(no cloud project linked yet — replace `<PROJECT_REF>` after `supabase link`)*
- Deploy workflow: **manual** (`supabase db push` + `supabase functions deploy`; `eas build`/`eas submit` for the app)
- Deploy status command: `supabase functions list` and `supabase migration list --linked`
- Merge method: merge (PRs merged with `gh pr merge <N> --merge`, per project history)
- Project type: native mobile app + Supabase backend
- Post-deploy health check: `curl -sf "https://<PROJECT_REF>.supabase.co/functions/v1/flyer?report=<any-active-report-uuid>" -o /dev/null -w "%{http_code}"` (expects 200; flyer is the only public HTTP surface)

### Custom deploy hooks
- Pre-merge: `npm test` (63 unit) + `npm run test:rls` (35 integration, needs local Supabase up) + `npx tsc --noEmit`
- Deploy trigger: manual — see Backend runbook + App runbook below
- Deploy status: `supabase functions list` (functions), `supabase migration list --linked` (migrations), Dashboard → Database → Cron jobs (pg_cron), Dashboard → Database → Webhooks (notify-* wiring)
- Health check: the flyer curl above

---

### Backend deploy runbook (Supabase cloud) — run once to set up, then per release

**0. One-time: create + link the cloud project**
```bash
# Create a project at https://supabase.com/dashboard (note the project ref, e.g. abcd1234efgh)
supabase login
supabase link --project-ref <PROJECT_REF>
```
Then replace every `<PROJECT_REF>` in this file with the real ref.

**1. Push migrations (0001–0014)**
```bash
supabase db push          # applies all migrations incl. storage buckets (dog-images, sightings)
supabase migration list --linked   # verify remote has 0001..0014
```
- `0013_expiry.sql` runs `create extension if not exists pg_cron;`. If push errors that pg_cron is unavailable, enable it first in Dashboard → Database → Extensions (`pg_cron`), then re-run `supabase db push`.

**2. Verify pg_cron jobs registered** (Dashboard → Database → Cron jobs)
- `expire-reports` — `0 3 * * *`
- `purge-notif-logs` — `30 3 * * *`

**3. Set Edge Function secrets** (only these two; `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are auto-injected)
```bash
# Firebase service-account JSON for FCM HTTP v1 (used by notify-nearby + notify-message)
supabase secrets set FCM_SERVICE_ACCOUNT="$(cat /path/to/firebase-service-account.json)"
# Google Static Maps key for the flyer map thumbnail (referrer-restricted; used by flyer)
supabase secrets set GOOGLE_STATIC_MAPS_KEY="<google-static-maps-key>"
supabase secrets list   # confirm both present
```

**4. Deploy the three Edge Functions**
```bash
# flyer is PUBLIC (anonymous browsers hit it) -> must skip JWT verification
supabase functions deploy flyer --no-verify-jwt
# notify-* are invoked by Database Webhooks with the service-role key -> keep JWT verification on (default)
supabase functions deploy notify-nearby
supabase functions deploy notify-message
supabase functions list   # confirm all three ACTIVE
```

**5. Wire Database Webhooks** (Dashboard → Database → Webhooks) — these trigger the notify-* functions
- **notify-nearby**: table `public.missing_reports`, event `INSERT`, type "Supabase Edge Functions" → `notify-nearby`. Add header `Authorization: Bearer <SERVICE_ROLE_KEY>`.
- **notify-message**: table `public.messages`, event `INSERT`, → `notify-message`. Same auth header.
- (Realtime for chat is already enabled by migration `0010_chat.sql` via `alter publication supabase_realtime add table public.messages`.)

**6. Point the app at the cloud project** — set the app's env (`.env` / EAS secrets):
- `EXPO_PUBLIC_SUPABASE_URL=https://<PROJECT_REF>.supabase.co`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key>` (Dashboard → Project Settings → API)

**7. Health check**
```bash
curl -sf "https://<PROJECT_REF>.supabase.co/functions/v1/flyer?report=<active-report-uuid>" -o /dev/null -w "%{http_code}\n"   # expect 200
```

### App deploy runbook (EAS/Expo)
No `eas.json` yet. First time:
```bash
npm i -g eas-cli && eas login
eas build:configure         # creates eas.json (dev/preview/production profiles)
```
Then:
```bash
eas build --profile development --platform android   # dev client for on-device QA (maps, push, location)
eas build --profile production --platform all        # store builds
eas submit --platform android                         # / ios — submit to stores
```
- Native modules requiring a dev client (not Expo Go): react-native-maps, expo-location background, FCM. Device QA must run on an EAS dev-client build, not Expo Go.
- External keys needed before a working build: Firebase (FCM + `google-services.json`/`GoogleService-Info.plist`), Google Maps Android/iOS SDK keys, Google Static Maps key (server-side, set as the Supabase secret above), Kakao (if used for auth/maps).

### Deferred manual QA tasks (tracked)
Each sub-project left a device-QA/deploy task: SP1 #30, SP2 #51, SP3a #65, SP4 #78, SP3b #91, SP3c #104. They all depend on the steps above (cloud project + secrets + webhooks + dev-client build).
