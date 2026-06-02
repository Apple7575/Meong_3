# 멍백홈 아키텍처 & 설계 판단 (개발자용)

이 문서 하나로 "어떻게 돌아가는지 + 왜 이렇게 골랐는지 + 화면 구조"를 잡는다.
더 깊은 건 `docs/superpowers/specs/`(설계)와 `docs/superpowers/plans/`(구현 계획) 참고.

---

## 1. 한눈에

**멍백홈** = 위치 기반 실종견 구조 앱. 핵심 가설: *"실종 시점에 주변에 깔려있는 사용자 밀도"* 가 구조 확률을 결정한다 → 그래서 **산책 기능으로 평소 밀도를 만들고**, 실종 시 그 밀도에 푸시를 쏜다.

```
┌─────────────────────────────────────────────────────────┐
│  앱 (Expo / React Native, TypeScript)                     │
│  app/ = 화면(expo-router)   src/services = 로직   src/lib  │
└───────────────┬─────────────────────────────────────────┘
                │  @supabase/supabase-js (anon 키, RLS 적용)
                ▼
┌─────────────────────────────────────────────────────────┐
│  Supabase 클라우드 (ncvpijihbmpnwvqdomzg)                   │
│  • PostgreSQL + PostGIS (geography, ST_DWithin …)         │
│  • RLS (행 단위 권한)  • RPC (SECURITY DEFINER 함수)        │
│  • Realtime (채팅)  • Storage (사진)  • pg_cron (만료배치)  │
│  • Edge Functions (Deno): flyer / notify-nearby / notify-message │
└───────────────┬─────────────────────────────────────────┘
                │  Database Webhook (INSERT 시 함수 호출)
                ▼   FCM HTTP v1 (Firebase) → 기기 푸시
```

**3계층 규칙(이 프로젝트의 핵심 원칙):**
1. **화면(app/)은 로직을 모른다.** 화면은 `src/services/*`만 호출. (테스트·재사용 위해)
2. **서비스(src/services/)는 supabase 클라이언트만 부른다.** 순수 계산은 `src/lib/`(geo, walkSession 등)로 분리 → 단위테스트가 쉬움.
3. **권한은 DB가 강제한다(RLS).** 앱은 anon 키로 접속하고, "내 것만 보임/쓸 수 있음"은 전부 Postgres RLS 정책이 막는다. 앱 코드 버그가 나도 DB가 최후 방어선.

---

## 2. 폴더 구조

```
app/                         # expo-router 파일 = URL 라우트
  index.tsx                  # 진입 게이트 (로그인 여부 → 분기)
  (auth)/login.tsx           # 시작 화면 (지금 이메일만)
  (auth)/email.tsx           # 이메일 로그인/가입
  (onboarding)/profile.tsx   # 가입 직후 닉네임·연락처 입력 게이트
  (app)/home.tsx             # 홈 (산책/지도/내 신고 진입)
  (app)/walk/index.tsx       # 산책 추적 (실시간 경로)
  (app)/walk/summary.tsx     #   종료 후 거리·시간
  (app)/walk/history.tsx     #   기록 + 통계(스트릭)
  (app)/dogs/new.tsx         # 강아지 등록 (사진 업로드)
  (app)/report/new.tsx       # 실종 신고 작성
  (app)/report/[id]/index.tsx    # 신고 상세 (제보/전단공유/채팅)
  (app)/report/[id]/sighting.tsx # 목격 제보
  (app)/report/[id]/track.tsx    # 보호자용 추적지도 (+숨김/신고)
  (app)/map.tsx              # 동네 실종 지도 (클러스터)
  (app)/chats.tsx            # 내 대화 목록
  (app)/chat/[id].tsx        # 1:1 채팅 (+차단/메시지신고)
  (app)/reports.tsx          # 내 신고 목록

src/services/   # 각 도메인 1파일 (화면이 부르는 API)
  auth, profile, dogs, images, location,        # SP1 기반
  walks,                                          # SP2 산책
  missingReports, sightings, push,                # SP3a 위기
  chats,                                          # SP4 채팅
  flyer, neighborhoodMap,                         # SP3b 전단/지도
  moderation                                      # SP3c 숨김/차단/신고

src/lib/        # 순수 로직 + 인프라
  supabase.ts      # 클라이언트 (SecureStore에 세션 저장)
  session.ts       # 로그인 상태
  geo.ts           # 거리/면적 계산 (haversine 등) — 순수함수
  walkSession.ts   # 산책 타이머 상태머신 (일시정지 포함) — 순수
  walkLocation.ts  # expo-location 백그라운드 추적 태스크
  walkStorage.ts   # 강제종료 복구용 로컬 저장
  activeWalk.ts    # 진행중 산책 싱글톤
  pushNav.ts       # 푸시 탭 → 화면 이동
  bootstrap.ts     # 앱 시작 시 권한/푸시 토큰 등록

supabase/migrations/  # DB 스키마 (0001~0014, 순서대로 적용)
supabase/functions/   # Edge Functions (Deno)
```

---

## 3. 데이터 모델 (주요 테이블)

| 테이블 | 핵심 컬럼 | 비고 |
|---|---|---|
| `profiles` | nickname, phone | auth 가입 시 트리거로 자동 생성 |
| `dogs` | owner_id, name, breed, gender, is_neutered, features | |
| `dog_images` | dog_id, storage_path, is_primary | Storage 버킷 `dog-images` |
| `walk_records` | user_id, route_geojson, distance_m, duration_s, use_for_missing_search | 밀도 데이터 |
| `user_locations` | user_id, point(geography) | 푸시 대상 찾기용 최근 위치 |
| `missing_reports` | owner_id, dog_id, status(active/resolved/expired), last_seen_point, alert_radius_m, expires_at | 신고 |
| `sightings` | report_id, reporter_id, point, hidden | 목격 제보 |
| `chats` / `messages` | report_id, owner_id, reporter_id / body | 1:1 채팅 |
| `notification_logs` | report_id, user_id, token, status | 푸시 감사 로그(30일 TTL) |
| `blocks` / `content_flags` | blocker/blocked / content_type,id,reason | 모더레이션 |

**RLS 철학:** 모든 정책 `TO authenticated`. 민감 조회는 **SECURITY DEFINER RPC**로 감싸고 `revoke execute from public, anon` + `grant authenticated`(또는 cron은 service_role)로 잠근다. 예) `report_detail`, `my_chats`, `tokens_near_report`. 이렇게 한 이유는 §5 참고.

---

## 4. 핵심 흐름 4가지

### (A) 인증 → 온보딩
`app/index.tsx`가 세션을 보고 → 없으면 `(auth)/login`, 있는데 프로필 미완성이면 `(onboarding)/profile`, 완성이면 `(app)/home`. 세션은 `expo-secure-store`에 저장(토큰 안전 보관).

### (B) 산책 = 밀도 엔진 (SP2)
`walk/index` 시작 → `walkLocation.ts`가 **백그라운드 위치 추적**(화면 꺼져도) → `walkSession.ts` 상태머신이 거리/시간 누적(일시정지 구간 제외) → 종료 시 `walk_records`에 GeoJSON 경로 저장 + `user_locations` 갱신. 강제종료돼도 `walkStorage`로 복구. 통계(연속일=스트릭)는 `my_walk_stats` RPC.
→ **왜 핵심이냐:** 이 산책들이 "평소에 어디에 사람이 있는지"를 만든다. 실종 푸시의 사정거리가 여기서 나온다.

### (C) 위기 루프 + 푸시 (SP3a)
보호자가 `report/new`로 신고 INSERT
→ **Database Webhook**이 `notify-nearby` 함수 호출
→ 함수가 `tokens_near_report` RPC(PostGIS `ST_DWithin`로 alert_radius 내 사용자 토큰 조회, **service_role 전용**)
→ **FCM HTTP v1**로 푸시 발송 + `notification_logs` 기록
→ 주변 사용자가 푸시 탭(`pushNav`) → 신고 상세 → 목격 제보(`sighting`)
→ 보호자는 `track`에서 제보 핀들을 지도로 봄.

### (D) 채팅 (SP4)
제보자↔보호자 1:1. `get_or_create_chat` RPC(제보 있는 사람만 가능) → `messages` INSERT → **Realtime**으로 상대 화면에 즉시 + **Webhook**이 `notify-message` 호출해 푸시. 신고가 expired/resolved면 RLS가 전송을 막아 **읽기전용**으로 자동 전환.

### (E) 유통/안전 (SP3b, SP3c)
- **전단(flyer)**: `flyer` Edge Function이 신고를 **무설치 웹페이지(HTML)** 로 서빙(사진·구글 정적지도·앱 CTA, 전화·소유자 비노출). 앱에서 QR/링크 공유.
- **동네지도**: `active_reports_in_bounds` RPC + react-native-maps 클러스터링.
- **만료배치**: `pg_cron`이 매일 14일 지난 신고를 expired로, 30일 지난 로그 삭제.
- **모더레이션**: 숨김(`hide_sighting`), 차단(`blocks` + 메시지 전송 양방향 차단가드), 신고기록(`content_flags`).

---

## 5. 판단 기준 (왜 이걸 골랐나 — Decision Log)

> 전부 오피스아워 전략문서 + 각 spec의 "접근법 비교"에서 나온 결정. "대안 / 고른 것 / 이유" 형식.

| 결정 | 대안들 | 고른 것 | 판단 기준 |
|---|---|---|---|
| **전체 형태** | A:웹MVP / B:하이브리드 / C:기존앱연동 / **D:풀 네이티브** | **D** | 핵심 가치(백그라운드 위치·푸시·지도)가 네이티브 권한 없이는 불가능. 웹으론 밀도 엔진 자체가 안 됨 |
| **신고 진입점** | 웹+앱 둘다 / **앱 전용(A)** | **앱 전용** | 신고자=보호자는 절박해서 설치 의향 높음. 앱 일관성 유지하고 복잡도↓. 대신 *발견*은 무설치 웹전단으로 보완 |
| **밀도 확보** | 광고로 사용자 유치 / **산책 기능으로 리텐션** | **산책** | 평상시 앱 열 이유(리텐션 훅)가 있어야 실종 순간 주변에 사람이 있음. 산책=개주인의 자연 행동 |
| **푸시 발동** | 앱이 폴링 / 클라이언트 트리거 / **DB Webhook** | **Webhook** | 신고 INSERT가 곧 트리거. 서버리스(Edge Function)라 상시 서버 불필요. 폴링은 배터리·지연 나쁨 |
| **만료 배치** | 스케줄드 Edge Function / **pg_cron** | **pg_cron** | 순수 SQL 한 줄(status 전환)이라 함수 띄울 필요 없음. expired→채팅닫힘·지도제외가 RLS로 자동 파생(추가코드 0) |
| **전단** | 앱 합성이미지 / 네이티브 공유 / **Edge Function HTML** | **웹 HTML** | 무설치로 누구나 봄(발견 극대화). 비-사용자도 강아지 정보 접근, 제보는 앱으로 유도 |
| **지도 SDK** | 카카오맵 / **구글(react-native-maps)** | **구글맵** | 클러스터링 라이브러리 생태계·RN 통합 성숙. 카카오는 보류 |
| **로그인** | 카카오/구글 OAuth / **이메일 우선** | **이메일**(OAuth는 코드만 남김) | OAuth provider 설정 복잡 → 핵심 검증을 막지 않게 이메일로 먼저, 나중 확장 |
| **권한 모델** | 앱에서 체크 / **DB RLS + SECURITY DEFINER RPC** | **DB 강제** | 위기 앱은 개인정보(위치·전화) 민감. 앱 버그가 나도 DB가 막아야 함. 민감 조회는 RPC로 좁힘 |
| **개발 방식** | 직접 작성 / **TDD + 서브에이전트 + Codex 교차검증** | **후자** | 각 기능: 브레인스토밍→spec→plan→실패테스트→구현→Codex리뷰→머지. 보안버그(익명 데이터노출, 토큰 수집, 단방향 차단)를 매 단계 Codex가 잡음 |

---

## 6. 와이어프레임 (주요 화면)

```
[로그인]                  [홈]                       [산책 중]
┌──────────────┐         ┌──────────────┐          ┌──────────────┐
│              │         │  멍백홈        │          │   00:12:34    │
│   멍백홈 🐶   │         │              │          │   1.2 km      │
│              │         │ [🐕 산책 시작] │          │ ┌──────────┐ │
│ ┌──────────┐ │         │ [🗺 동네 지도] │          │ │  지도     │ │
│ │이메일로 시작│ │   →     │ [📋 내 신고]  │    →     │ │ ~~경로~~  │ │
│ └──────────┘ │         │ [💬 대화]     │          │ └──────────┘ │
│              │         │ [🐶 강아지등록]│          │ [일시정지][종료]│
└──────────────┘         └──────────────┘          └──────────────┘

[신고 상세]               [추적지도(보호자)]          [채팅]
┌──────────────┐         ┌──────────────┐          ┌──────────────┐
│ [강아지 사진]  │         │ ┌──────────┐ │          │ 제보자    [차단]│
│ 초코 · 푸들    │         │ │지도 +핀들 │ │          │ ┌──────┐     │
│ 📍 마지막목격  │         │ └──────────┘ │          │ │봤어요!│     │
│ ┌─미니맵─┐    │   →     │ 제보 3건      │          │ └──────┘     │
│ └────────┘    │         │ 1.목격…[숨김][신고]│ ←   │   ┌──────┐   │
│ [전단 공유]    │         │ 2.목격…💬대화 │          │   │어디서?│   │
│ [👀 제보하기]  │         │ ...           │          │ [메시지___][전송]│
└──────────────┘         └──────────────┘          └──────────────┘

[동네 지도]               [웹 전단 (무설치, 브라우저)]
┌──────────────┐         ┌──────────────┐
│ 활성 3건 [최근3일]│       │ [강아지 사진]  │
│ ┌──────────┐ │         │ 초코를 찾아요  │
│ │  🔴 🔴    │ │         │ 푸들·갈색      │
│ │   (3) 🔴  │ │  공유→   │ [구글 정적지도] │
│ │클러스터    │ │         │ 마지막목격 시각 │
│ └──────────┘ │         │ [멍백홈 앱에서  │
│ 탭→상세       │         │  제보하기]     │
└──────────────┘         └──────────────┘  (전화·소유자 X)
```

---

## 7. 어떻게 만들어졌나 (프로세스)

기획안 → **오피스아워**(전략·범위) → 6개 서브프로젝트로 분해. 각 SP는 동일 파이프라인:

1. **브레인스토밍**(superpowers) → 대안 비교 → 사용자 승인
2. **spec** 작성 (`docs/superpowers/specs/`)
3. **plan** 작성 (`docs/superpowers/plans/`, 태스크별 TDD)
4. **Codex 교차검증** (plan + 구현 diff) — 보안/버그 게이트
5. **서브에이전트 TDD 구현** (실패테스트→구현→통과→커밋)
6. **PR → main 머지**

| SP | 내용 | 산출 |
|---|---|---|
| SP1 | 기반·신원 | auth/profile/dogs + RLS + Storage |
| SP2 | 밀도엔진(산책) | walk 추적·통계·복구 |
| SP3a | 위기 코어루프 | 신고→푸시→제보→추적 |
| SP4 | 채팅 | 1:1 Realtime + 푸시 |
| SP3b | 전단+동네지도 | flyer 함수, 클러스터 지도 |
| SP3c | 만료+모더레이션 | pg_cron, 숨김/차단/신고 |

**테스트:** 단위 63개(jest, supabase 목) + 통합 35개(로컬 Supabase, RLS·RPC 실제검증). 배포는 `docs/HANDOFF.md`/`CLAUDE.md` 런북 참고.
