# 설계: 멍백홈 — Sub-project 1 「기반 & 신원」

- **작성일**: 2026-06-02
- **방식**: superpowers:brainstorming (시각 동반 도구 사용)
- **상위 전략 문서**: `~/.gstack/projects/MeongBackHome/cruel-unknown-design-20260601-224226.md` (office-hours, APPROVED)
- **스택**: React Native (Expo, Dev Client + EAS Build) · Supabase · Kakao Map · FCM
- **상태**: 설계 승인됨 → 구현 플랜 작성 대기

---

## 1. 배경 & 결정 경로

상위 전략 문서에서 창업자는 **Approach D(풀 네이티브 설치 앱, 기능 축소 없음)**를 명시적으로 선택했다. 이 세션에서 그 위에 다음 결정을 내렸다:

1. **제보 경로 = A (앱 사용자 전용 제보).** 무설치 웹 제보(B)는 채택하지 않음.
   - 근거: **산책 기능을 밀도 획득 엔진**으로 삼아, 평상시 앱 설치·리텐션을 키우고 위기 순간에 그 설치 기반으로 알림·제보를 돌린다.
   - **명시된 리스크(삭제 금지)**: A는 "산책으로 밀도를 먼저 확보한 뒤에야" 위기 코어 루프 검증이 가능하다. 노원구 첫날 밀도 0이면 주변 알림이 닿지 않는다. 따라서 산책은 더 이상 후순위 기능이 아니라 **1단계의 필수 부품**이며, 밀도 시딩(보호소·동물병원 앵커, 지역 커뮤니티)은 빌드와 병행해야 한다. 미검증 수요(신소영 체크·보호자 인터뷰) 과제도 그대로 유효.

2. **1~10번 전체를 만들되, 의존성 순서로 4개 하위 프로젝트로 분해**한다. 각 묶음은 독립 스펙→플랜→구현 사이클을 돈다.
   - **Sub-project 1 — 기반 & 신원** ← 본 문서
   - Sub-project 2 — 밀도 엔진 (산책 기록)
   - Sub-project 3 — 위기 코어 루프 (실종 신고·전단·주변 알림·동네 지도·목격 제보·추적 지도)
   - Sub-project 4 — 연결 (채팅)
   - 공통 인프라(전 묶음 관통): Supabase(Auth·PostgreSQL·PostGIS·Storage) · Kakao Map · FCM · 위치/권한 · 안전·악용 방어 · 만료 배치(신고 14일·알림로그 30일)

3. **빌드 방식 = Expo (Dev Client + EAS Build).** EAS가 iOS 서명/안드로이드 빌드를 대행. 네이티브가 필요한 부분(추후 카카오맵 네이티브 SDK)은 config plugin으로 결합. 1인 개발 속도 최적.

---

## 2. 이 묶음의 범위

**포함 (기획안 항목 ①②):**
- 로그인 (카카오 · 구글 OAuth · 이메일+비밀번호)
- 프로필 + 온보딩(닉네임·연락처 필수)
- 반려견 등록 (사진 · 이름 · 견종 · 성별 · 중성화 · 특징 · 비상연락처)
- FCM 토큰 발급·등록 (발송은 Sub-project 3)
- 사용자 위치 적재 (사용자당 최신 1개)
- 공통 인프라 부트스트랩: Supabase 프로젝트, PostGIS, Storage 버킷, 본 묶음 5개 테이블 + RLS + 가입 트리거

**제외 (다른 묶음/후순위):**
- 산책 기록(Sub-project 2), 위기 코어 루프 화면(Sub-project 3), 채팅(Sub-project 4)
- 푸시 **발송** 로직, 지도 렌더링(이 묶음은 좌표 수집만)
- 무설치 웹 제보(A 선택으로 제외)

---

## 3. 아키텍처 · 구성요소

```
📱 Expo RN 앱                         🗄️ Supabase                      🌐 외부
  화면: 로그인·프로필·반려견 등록   ──OAuth──▶  Auth(카카오·구글·이메일)  ◀──▶ 카카오/구글 OAuth
  서비스: auth·location·push·upload ──REST/RPC─▶ Postgres+PostGIS(5 테이블)
  로컬: secure-store(세션)          ──업로드──▶  Storage(dog-images 버킷)
                                                RLS 정책 · 가입 트리거
  push 서비스 ───────────────────────────────────────────────────────▶ FCM(토큰 발급·등록만)
```

**핵심 데이터 흐름**
1. 로그인(카카오/구글/이메일) → Supabase Auth → 세션을 expo-secure-store에 저장
2. 가입 순간 DB 트리거가 `profiles` 행 자동 생성 → 앱 온보딩이 닉네임·연락처 보완
3. FCM 토큰 발급 → `fcm_tokens` upsert (기기별)
4. 위치 권한 허용 시 현재 좌표 → `user_locations` upsert (사용자당 1행)
5. 반려견 등록: `dogs` 행 + 사진 Storage 업로드 → `dog_images`

**라이브러리 결정**
- FCM: **react-native-firebase (messaging)** 를 Expo config plugin으로 결합해 FCM 토큰 직접 발급 (Expo 자체 푸시 서비스 대신 FCM 직결 — 한국 환경·향후 데이터 푸시에 견고)
- OAuth: Supabase Auth + expo-web-browser/딥링크 (`meongbackhome://auth-callback`)
- 세션 저장: expo-secure-store
- 이미지: expo-image-picker (선택·크롭·리사이즈)
- 위치: expo-location

---

## 4. 데이터 모델

기획안 10-1의 14개 테이블 중 본 묶음이 생성하는 5개.

### `profiles` — `auth.users`와 1:1 (가입 트리거로 자동 생성)
| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | uuid PK | → `auth.users(id)` ON DELETE CASCADE |
| `nickname` | text | 온보딩에서 필수 입력 |
| `phone` | text | 보호자 연락처. **푸시 본문·공개 페이지 노출 금지**, 앱 내부 표시만. 온보딩 필수 |
| `avatar_url` | text NULL | |
| `created_at` / `updated_at` | timestamptz | |

> DB 컬럼은 트리거 자동생성을 위해 nullable. 앱 온보딩 게이트가 `nickname`·`phone`을 채우기 전 진행 차단.

### `fcm_tokens` — 기기별 푸시 토큰
| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `user_id` | uuid | → `profiles(id)` CASCADE |
| `token` | text UNIQUE | |
| `platform` | text | CHECK in (`ios`,`android`) |
| `last_seen_at` / `created_at` | timestamptz | 오래된 토큰 정리용 |

### `user_locations` — 사용자당 최신 1개
| 컬럼 | 타입 | 비고 |
|---|---|---|
| `user_id` | uuid **PK** | → `profiles(id)` CASCADE. PK가 user_id라 1행 강제 |
| `geom` | `geography(Point,4326)` | **GIST 인덱스** |
| `updated_at` | timestamptz | |

### `dogs`
| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | uuid PK | |
| `owner_id` | uuid | → `profiles(id)` CASCADE |
| `name` | text NOT NULL | |
| `breed` | text | 견종 |
| `gender` | text | CHECK in (`male`,`female`,`unknown`) |
| `is_neutered` | boolean NULL | 중성화: true/false, NULL=모름 |
| `features` | text | 특징(색·크기·습관 등 자유 서술) |
| `emergency_contact` | text | 비상연락처 (비우면 `profiles.phone` 사용) |
| `created_at` / `updated_at` | timestamptz | |

### `dog_images`
| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | uuid PK | |
| `dog_id` | uuid | → `dogs(id)` CASCADE |
| `storage_path` | text | `dog-images/{user_id}/{dog_id}/{uuid}.jpg` |
| `is_primary` | boolean | 대표 사진 |
| `sort_order` | int | |

### RLS 정책 (본인 데이터만)
- `profiles` / `fcm_tokens` / `user_locations`: 본인 행만 SELECT·INSERT·UPDATE·DELETE (`auth.uid()` 일치)
- `dogs` / `dog_images`: 소유자만 (`owner_id = auth.uid()`; `dog_images`는 부모 `dogs` 소유 검사)
- Storage `dog-images` 버킷: 본인 폴더(`{user_id}/...`)에만 업로드·읽기

### 부가
- 가입 트리거: `auth.users` AFTER INSERT → `INSERT INTO profiles(id) VALUES (new.id)`
- PostGIS 확장 활성화, `user_locations.geom`에 GIST 인덱스
- **나중 확장 메모**: Sub-project 3에서 타인이 실종견 정보·사진을 봐야 하므로 "활성 신고에 연결된 dog는 공개 읽기 허용" 정책을 그때 추가. 본 묶음은 소유자 전용.

---

## 5. 인증 · 온보딩 흐름

1. **앱 실행** → secure-store 세션 확인 → 유효하면 자동 로그인(홈), 없으면 로그인 화면
2. **로그인 화면** — 버튼 3개
   - 카카오/구글: 인앱 브라우저(expo-web-browser)로 Supabase OAuth → 동의 → `meongbackhome://auth-callback` 딥링크 복귀 → 세션 발급 → secure-store 저장
   - 이메일: **이메일+비밀번호**, 가입 시 **이메일 인증** 요구
3. **온보딩 게이트** — `profiles`의 `nickname`·`phone`이 비었으면 온보딩 화면 강제: 닉네임(필수)·연락처(필수) → `profiles` 업데이트
4. **권한 & 기반 적재** — 푸시 권한 → FCM 토큰 → `fcm_tokens` upsert / 위치 권한 → 좌표 → `user_locations` upsert (**거부해도 진행 가능**, "주변 알림 수신 불가" 안내만, 나중에 재요청)
5. **홈 진입** — 본 묶음에선 거의 비어있고 "반려견 등록" CTA만

---

## 6. 반려견 등록

**폼 필드**: 사진(다중, 대표 지정) · 이름* · 견종 · 성별(수컷/암컷/모름) · 중성화(예/아니오/모름) · 특징 · 비상연락처(프로필 번호 기본값·수정 가능)

**사진 업로드 처리**
1. expo-image-picker로 선택·크롭·리사이즈(용량↓)
2. `dogs` 행 먼저 insert → `dog_id` 확보
3. Storage 업로드 → `dog-images/{user_id}/{dog_id}/{uuid}.jpg`
4. `dog_images` 행 insert (storage_path·is_primary·sort_order)
5. 실패 시: 부분 업로드 정리(고아 파일 방지) + 재시도 안내

**검증 규칙**: 이름만 필수, 나머지 선택. 사진 0장도 등록 허용(나중 추가 가능; 실종 신고 땐 대표사진 권장). 비상연락처 비우면 `profiles.phone` 사용.

---

## 7. 에러 처리 · 엣지 케이스

- **인증**: OAuth 취소/거부 → 조용히 복귀 / 딥링크 미복귀 → 타임아웃 후 재시도 안내 / 이미 가입된 메일·비밀번호 오류·미인증 메일 → 명확한 메시지 + 인증메일 재발송 / 세션 만료 → 자동 갱신, 실패 시 재로그인
- **FCM·위치**: 푸시 권한 거부 → 진행, 설정에서 나중에 활성화 / 토큰 갱신 리스너로 `fcm_tokens` 자동 업데이트, 다기기=토큰 다수 허용 / 위치 거부 → 진행 + 배너 안내
- **등록·업로드**: 부분 업로드 실패 → 고아 파일 rollback + 재시도 / 큰 사진 → 사전 리사이즈 / 오프라인 → 명확한 에러 + 재시도(큐잉은 YAGNI로 제외)
- **공통**: 모든 쓰기는 멱등 upsert, 로딩/에러 상태 UI 일관성

---

## 8. 테스트 전략

- **단위(TDD)**: 서비스 계층(auth·profile·dog CRUD·upload)을 Supabase 클라이언트 목으로 검증
- **RLS 통합 테스트 ⭐**: 로컬 Supabase(`supabase start`)에 실제 정책 적용 → 사용자 A가 B의 `profiles`/`dogs`/`user_locations`를 못 읽는지 검증 (데이터 격리 = 안전 이슈)
- **DB**: 가입 트리거가 `profiles` 생성, 제약(토큰 UNIQUE·gender CHECK) 동작 확인
- **수동/실기기**: 카카오·구글 OAuth, 푸시 토큰 발급, 위치 수집 — Dev Client 빌드 + 실기기 필요(자동화 한계)
- (선택) 핵심 흐름 E2E는 Maestro 고려 — 본 묶음 필수 아님

---

## 9. 의존성 · 사전 준비

- Supabase 프로젝트(Auth·PostgreSQL·PostGIS·Storage) + 로컬 Supabase CLI
- Expo 프로젝트 + EAS 계정, Dev Client 빌드 파이프라인
- 카카오 개발자 앱(로그인 키·리다이렉트 URI) · 구글 OAuth 클라이언트
- Firebase 프로젝트(FCM) + react-native-firebase config plugin
- 딥링크 스킴 `meongbackhome://` 등록(iOS/Android)

---

## 10. 미해결 질문 (다음 묶음 또는 빌드 중 해결)

- 산책 기반 밀도 시딩을 어떻게 부트스트랩할지(보호소·병원 앵커, 지역 커뮤니티) — Sub-project 2/배포 계획에서 구체화
- 미검증 수요(신소영 체크·보호자 인터뷰)는 빌드와 병행 필수 (상위 전략 문서 "The Assignment" 참조)
- 이메일 인증 UX 세부(딥링크 vs 코드 입력)는 구현 시 결정
- Sub-project 3에서 추가될 dog 공개 읽기 RLS 정책의 정확한 범위
