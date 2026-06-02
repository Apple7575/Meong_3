# 설계: 멍백홈 — Sub-project 3b 「온라인 전단 + 동네 실종 지도」

- **작성일**: 2026-06-02
- **방식**: superpowers:brainstorming
- **상위 전략 문서**: `~/.gstack/projects/MeongBackHome/cruel-unknown-design-20260601-224226.md` (office-hours) — 기획안 항목 5(온라인 전단 QR), 7(동네 실종 지도)
- **선행**: SP1·SP2·SP3a (main 병합) — missing_reports·sightings·dogs·dog_images·react-native-maps
- **스택**: Expo RN · Supabase(Edge Functions · PostGIS) · react-native-maps · Google Static Maps API
- **상태**: 설계 승인됨 → 구현 플랜 작성 대기

---

## 1. 배경 & 전략적 결정

SP3a에서 미룬 **유통/발견** 기능. 두 부분:
- **온라인 전단(QR)**: 보호자가 신고를 QR/링크로 살포 → 비-사용자도 강아지 정보를 봄.
- **동네 실종 지도**: 앱 사용자가 주변 활성 신고를 지도로 탐색.

**전략적 결정(이번 세션):** 오피스아워 문서는 "웹 전단/링크(무설치)를 1차 유통"으로 강조했고 창업자는 A(앱 전용 제보)를 택했다. 절충으로 — **전단 QR/링크 → 무설치 웹 상세(읽기 전용), 제보는 앱으로 유도**(웹 제보는 안 함, A 유지). 전단이 실제로 기능하면서 A 일관.

---

## 2. 범위

**포함:**
- 공개 웹 상세 페이지(Edge Function HTML): 강아지 사진·이름·견종·특징·마지막 목격(Google Static Maps 썸네일+시각)·"앱에서 제보" CTA. **전화·소유자 미노출.**
- 인앱 전단 공유: 공개 URL + QR(react-native-qrcode-svg) + 공유 시트 문구.
- 동네 실종 지도(인앱): 뷰포트 내 활성 신고 마커 + 클러스터링 + 최근성 필터 + 탭→신고 상세.

**제외 (YAGNI / 후순위):**
- `flyers` 테이블(전단=신고 파생), 전단 합성 이미지(view-shot), 웹 제보(item 11, A 유지), 견종/크기 필터, 무설치 웹 지도.

---

## 3. 온라인 전단 + 공개 웹 상세

### Edge Function `flyer` (Deno, service role)
- `GET /functions/v1/flyer?report=<uuid>` → service role로 `missing_reports`(+dogs, dog_images 대표사진) 조회.
  - `status='active'` → 모바일 HTML: 강아지 사진(dog-images **서명 URL**), 이름·견종·특징, **Google Static Maps 썸네일**(마지막 목격 center+marker) + 시각, "멍백홈 앱에서 제보하기" 버튼(앱스토어/딥링크 `meongbackhome://report/<id>`), Open Graph 태그.
  - resolved/expired/없음/잘못된 param → 친절한 안내 페이지(HTTP 200).
  - **출력에 phone·owner 정보 절대 없음**(함수가 안전 필드만 선택).
- **비밀키**: `GOOGLE_STATIC_MAPS_KEY`(SP2 안드로이드 키와 별개, referrer 제한) = 함수 env, static-map img URL에 주입(브라우저가 로드).
- 익명 공개 읽기지만 anon이 DB 직접 접근 안 함 — 함수가 active-only 강제. URL은 UUID(열거 어려움).
- 순수 헬퍼 `render.ts`: HTML escape, 안전필드 선택, static-map URL 빌드 — Deno 단위 테스트.

### 인앱 전단 공유 (보호자)
- 신고 상세/추적 화면 "전단 공유" → `buildFlyerUrl(reportId)`(공개 함수 URL) → QR 표시 + RN Share(문구 템플릿).
- 새 의존성: `react-native-qrcode-svg`(react-native-svg 재사용).
- `flyers` 테이블 없음.

---

## 4. 동네 실종 지도 (인앱)

- `app/(app)/map.tsx`: react-native-maps 뷰포트의 활성 신고 마커. 탭 → `/(app)/report/[id]`.
- RPC **`active_reports_in_bounds(min_lng, min_lat, max_lng, max_lat)`** (SECURITY DEFINER, **authenticated 전용** — revoke public/anon): `ST_MakeEnvelope` 내 `status='active'` 신고의 id·lat·lng·dog 이름·대표사진 path·last_seen_at 반환(안전 필드).
- 지도 영역 변경 → **디바운스 후 재조회**.
- **클러스터링**: `react-native-map-clustering`(supercluster 래퍼) — 저줌 묶음/고줌 펼침.
- **필터**: 최근성 토글(전체 / 최근 3일). 항상 active.
- 초기 중심 = 현재 위치(권한 없으면 노원 기본).
- 진입점: 홈 "동네 지도".

---

## 5. 파일 구조 · 에러 · 테스트

### 파일
- `supabase/functions/flyer/index.ts` + `render.ts`(+ Deno test)
- `supabase/migrations/0012_neighborhood.sql` — `active_reports_in_bounds` RPC
- `src/services/flyer.ts`(+test), `src/services/neighborhoodMap.ts`(+test)
- `app/(app)/map.tsx`; 수정: `report/[id]/index.tsx`(전단 공유), `home.tsx`(동네 지도 진입)

### 에러/안전
- flyer: 비활성/없음/잘못된 param → 안내 페이지(200); 서명URL 실패 → 사진 플레이스홀더; static map 실패 → 정보는 그대로(alt). 출력 phone 없음.
- 지도: 조회 실패 → 안내; 빈 결과 → "주변 활성 신고 없음"; 영역 변경 디바운스; 초기 중심 폴백.
- 공유 취소 → no-op.

### 테스트
- **단위(TDD)**: `flyer.ts`(buildFlyerUrl·공유 문구), `neighborhoodMap.ts`(reportsInBounds→rpc 인자).
- **통합(로컬 Supabase) ⭐**: `active_reports_in_bounds`가 envelope 내 active만·경계밖/resolved 제외; 익명 RPC 거부(authenticated 전용).
- **Edge Function**: `render.ts` 순수 헬퍼 Deno 테스트(HTML escape, **출력 phone 없음** 단언, static-map URL), active-only 게이팅.
- **수동/실기기**: QR 스캔→웹(사진·정적지도·앱 CTA) 렌더; 인앱 지도 클러스터·탭→상세·필터; 공유 시트.

---

## 6. 의존성 · 미해결
- SP1–SP3a 전제. react-native-qrcode-svg, react-native-map-clustering, Google Static Maps API 키(Edge Function secret).
- flyer 함수 배포 + (정적이라 webhook 불필요). 딥링크 스킴 `meongbackhome://report/<id>`는 SP3a pushNav 패턴 재사용.
- **미해결**: 전단 합성 이미지(후속); 지도 마커 대량 시 성능(클러스터로 완화, 상한 필요 시 후속); Static Maps 키 referrer 제한 설정(배포 시).
