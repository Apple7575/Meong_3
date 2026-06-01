# 설계: 멍백홈 — Sub-project 3a 「위기 코어 루프 (검증 웨지)」

- **작성일**: 2026-06-02
- **방식**: superpowers:brainstorming (시각 동반 도구 사용)
- **상위 전략 문서**: `~/.gstack/projects/MeongBackHome/cruel-unknown-design-20260601-224226.md` (office-hours, APPROVED)
- **선행**: SP1(기반·신원), SP2(밀도 엔진) — 둘 다 main 병합됨
- **스택**: Expo RN · Supabase(PostgreSQL/PostGIS · **Edge Functions**) · react-native-maps · FCM(Firebase Admin)
- **상태**: 설계 승인됨 → 구현 플랜 작성 대기

---

## 1. 배경 & 위치

4개 하위 프로젝트 분해에서 **SP3 = 위기 코어 루프**(제품의 본질). SP3 전체(실종신고·전단·주변알림·동네지도·목격제보·추적지도·연결·만료)는 매우 크고 **서버 푸시 발송**이라는 새 인프라를 포함하므로, **가장 얇은 검증 웨지(SP3a)를 먼저** 설계한다.

**SP3a 검증 질문:** "알림을 받은 이웃이 실제로 목격 제보를 하는가?" 제보 1건이 핵심 신호.

**A 결정(앱 전용 제보) 일관성:** 제보자는 항상 인증된 앱 사용자(`reporter_id` 항상 존재). 무설치 웹 제보는 채택 안 함.

---

## 2. 범위

**포함 (SP3a):**
- 실종 신고 생성: 등록견 선택 · 마지막 목격 위치(지도 핀) · 알림 반경 · 예상 도달 수 · 시각/메모
- 주변 알림 **발송**: Database Webhook → Edge Function → PostGIS 반경 쿼리 → FCM 발송 → `notification_logs`
- 푸시 수신 → 딥링크 → 신고 상세(이웃 뷰: 강아지 사진·특징·마지막 위치)
- 목격 제보: 사진 · 위치 핀 · 목격 시각 · 메모 → 활성 신고에 연결
- 추적 지도(보호자): 마지막 위치 + 제보 시간순 핀
- 내 신고 목록 / 상태(active·resolved)
- RLS 확장: "활성 신고 + 연결된 dog/이미지"를 인증 사용자에게 공개 읽기

**제외 (SP3b/3c/SP4):**
- QR/온라인 전단, 동네 지도 브라우즈·클러스터링·필터 (SP3b)
- 보호자↔제보자 연결(전화 노출/채팅 — 채팅=SP4) (SP3c/SP4)
- 동의 산책 경로 오버레이 활용 (SP3c)
- 만료 배치(신고 14일·`notification_logs` 30일 TTL) (SP3c) — `expires_at` 컬럼만 미리 둠
- 알림 수신 거부 설정, rate limit, 제보 숨김/신고하기, 자동 모더레이션 (SP3c)
- `missing_report_images`(실종견 사진은 SP1 `dog_images` 재사용)

---

## 3. 데이터 모델

새 마이그레이션 `0007_crisis.sql`(테이블+RLS+Storage), `0008_crisis_rpc.sql`(반경 RPC).

### `missing_reports`
| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | uuid PK | |
| `owner_id` | uuid NOT NULL → profiles ON DELETE CASCADE | 보호자 |
| `dog_id` | uuid NOT NULL → dogs ON DELETE CASCADE | 실종 등록견 |
| `status` | text NOT NULL default `active` | CHECK in (`active`,`resolved`,`expired`) |
| `last_seen_point` | geography(Point,4326) NOT NULL | **GIST 인덱스** |
| `last_seen_at` | timestamptz NOT NULL | |
| `alert_radius_m` | int NOT NULL | CHECK > 0 |
| `note` | text | |
| `expires_at` | timestamptz NOT NULL default `now()+interval '14 days'` | 만료 배치는 SP3c |
| `created_at`/`updated_at` | timestamptz | |
| `resolved_at` | timestamptz NULL | |
| 인덱스 | `(owner_id, created_at desc)`, GIST(`last_seen_point`), `(status)` | |

### `sightings`
| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | uuid PK | |
| `report_id` | uuid NOT NULL → missing_reports ON DELETE CASCADE | 반드시 신고에 연결 |
| `reporter_id` | uuid NOT NULL → profiles ON DELETE CASCADE | 제보자(앱 사용자) |
| `point` | geography(Point,4326) NOT NULL | |
| `seen_at` | timestamptz NOT NULL | |
| `note` | text | |
| `created_at` | timestamptz NOT NULL default now() | |
| 인덱스 | `(report_id, seen_at)` | 추적 지도 시간순 |

### `sighting_images`
`id` uuid PK · `sighting_id` → sightings CASCADE · `storage_path` text · `sort_order` int · `created_at`

### `notification_logs`
`id` uuid PK · `report_id` → missing_reports CASCADE · `user_id` → profiles · `token` text · `status` text(`sent`/`failed`) · `created_at` default now()

### RLS (핵심: 활성 신고 공개 읽기 확장)
- **`missing_reports`**: SELECT using `owner_id = auth.uid() OR status = 'active'`; INSERT/UPDATE/DELETE = `owner_id = auth.uid()`.
- **`dogs`** (SP1 소유자 전용 + 추가 SELECT 정책): `owner_id = auth.uid() OR exists(select 1 from missing_reports r where r.dog_id = dogs.id and r.status='active')`.
- **`dog_images`** (동일 확장): 부모 dog가 위 조건이면 SELECT 허용.
- **`sightings`**: INSERT with check `reporter_id = auth.uid() AND exists(select 1 from missing_reports r where r.id = report_id and r.status='active')`; SELECT using `reporter_id = auth.uid() OR exists(select 1 from missing_reports r where r.id = report_id and r.owner_id = auth.uid())`.
- **`sighting_images`**: 부모 sighting 가시성 따름(같은 조건 EXISTS).
- **`notification_logs`**: RLS on, 공개 정책 없음 — Edge Function이 service role로 기록(RLS 우회).

### Storage
- 새 비공개 버킷 `sightings`. 경로 `sightings/{reporter_id}/{sighting_id}/{uuid}.jpg`.
- INSERT: `(storage.foldername(name))[1] = auth.uid()::text` (제보자 본인 폴더).
- SELECT: 제보자 본인 **또는** 그 신고의 소유자 —
  `(storage.foldername(name))[1] = auth.uid()::text OR exists(select 1 from public.sightings s join public.missing_reports r on r.id = s.report_id where s.id::text = (storage.foldername(name))[2] and r.owner_id = auth.uid())`.

---

## 4. 푸시 발송 아키텍처

- **트리거**: Supabase **Database Webhook** on `missing_reports` INSERT → Edge Function `notify-nearby` (payload에 새 행 `id`). 앱과 무관하게 서버에서 발화 → 발송 보장.
- **Edge Function `notify-nearby`** (Deno, service role):
  1. `report_id` 수신.
  2. RPC `tokens_near_report(report_id)` (SECURITY DEFINER) 호출 → 신고 `last_seen_point` 기준 `alert_radius_m` 내 사용자(최신 `user_locations`, ST_DWithin), **소유자 제외**의 `fcm_tokens`(token·user_id·platform) 반환.
  3. FCM HTTP v1(Firebase Admin)로 배치 발송. data payload: `{ type:'missing_report', report_id }` → 앱 딥링크.
  4. 토큰별 `notification_logs`(sent/failed) 기록. **무효 토큰(unregistered)** → 해당 `fcm_tokens` 삭제(토큰 위생).
- **예상 도달 수**: 신고 작성 화면이 RPC `count_users_near(lat,lng,radius)` 호출 → 반경 내 사용자 수 미리보기.
- **비밀키**: Firebase 서비스계정 JSON = Supabase Edge Function secret. service role 키 = 함수 env.
- **딥링크**: SP1 `bootstrap.ts`의 알림 핸들러 확장 — 알림 탭 시 `report_id`로 `app/(app)/report/[id]` 이동.

---

## 5. 화면

라우트 `app/(app)/report/`.
- **신고 작성** (`report/new.tsx`): 지도 위치 핀(현재 위치 기본, 수동 조정) + 반경 슬라이더 + "약 N명에게 알림"(`count_users_near`) + 등록견 선택 + 목격 시각/메모. → `missing_reports` 생성(사진은 dog의 기존 사진 사용).
- **신고 상세** (`report/[id].tsx`, 이웃 뷰): 강아지 사진(dog_images)·이름·견종·특징, 마지막 목격 위치 미니맵, "👀 목격했어요" CTA.
- **목격 제보** (`report/[id]/sighting.tsx`): 사진(`sightings` 버킷 업로드) + 위치 핀(현재 위치 기본) + 목격 시각 + 메모 → `sightings`.
- **추적 지도** (`report/[id]/track.tsx`, 보호자): react-native-maps에 마지막 목격(★) + 제보 시간순 번호 핀 + 하단 목록.
- **내 신고** (`reports.tsx`): 내 신고 목록·상태, resolved 처리. 홈에 "실종 신고" 진입점 추가.

---

## 6. 에러 처리 · 안전 · 테스트

### 에러/엣지
- 위치 권한 없음 → 지도 수동 핀으로 진행(막지 않음).
- 사진 부분 업로드 실패 → SP1 고아 정리 패턴 + 재시도.
- 푸시 개별 실패 → `notification_logs` failed, 나머지 계속. 무효 토큰 → `fcm_tokens` 삭제.
- 반경 내 0명 → 신고 생성하되 "주변에 받을 사용자가 없어요(밀도 낮음)" 정직 안내.
- 신고/제보 저장 실패 → 명확한 에러 + 재시도(분실 방지).

### 안전(최소, 고도화는 SP3c)
- 제보 = 인증 사용자 + 활성 신고에만(RLS). rate limit·숨김·신고하기·모더레이션 = SP3c.

### 테스트
- **단위(TDD)**: `report.ts` 검증(반경 범위·필수·목격 시각 미래 금지) / `missingReports`·`sightings` 서비스(supabase 목).
- **통합(로컬 Supabase) ⭐**: RLS(이웃이 활성 신고+dog 읽기 가능, resolved 불가; 제보 INSERT 활성에만; 타인 제보 비공개; 소유자 전체 열람) + 반경 RPC 정확도(소유자 제외·반경 내만) + 기존 회귀.
- **Edge Function**: `notify-nearby` 로직 단위(FCM 클라이언트 목 — 발송 호출·로그 기록·무효 토큰 정리 검증).
- **수동/실기기**: 2기기(보호자/이웃) — 신고→푸시 수신→딥링크→제보→추적 지도.

---

## 7. 의존성 · 사전 준비
- SP1(profiles·dogs·dog_images·fcm_tokens·user_locations) + SP2(react-native-maps 도입) — 전제.
- Firebase 서비스계정 키(Edge Function secret), Supabase Edge Functions 배포 + Database Webhook 설정.
- (실기기 QA는 SP1/SP2 Task와 합류 — FCM 발송 실검증.)

---

## 8. 미해결 질문 (SP3b/3c 또는 구현 중)
- Database Webhook 로컬 개발 설정 방법(또는 로컬에선 함수 직접 invoke로 대체 테스트).
- 알림 data-only vs notification+data 페이로드(포그라운드/백그라운드 표시 차이) — 구현 시 확정.
- 한 dog에 active 신고 중복 허용 여부 — 일단 허용(YAGNI), 필요 시 SP3c에서 제약.
