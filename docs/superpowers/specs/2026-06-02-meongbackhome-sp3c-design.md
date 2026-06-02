# 설계: 멍백홈 — Sub-project 3c 「만료 배치 + 모더레이션」

- **작성일**: 2026-06-02
- **방식**: superpowers:brainstorming
- **상위 전략 문서**: office-hours — 신고 14일 자동 만료, 알림로그 30일 TTL, 제보 신고·숨김(안전/악용)
- **선행**: SP1–SP4, SP3a, SP3b (main 병합) — missing_reports·sightings·chats·messages·notification_logs·report_sightings/my_chats RPC
- **스택**: Supabase(PostgreSQL · **pg_cron**) · Expo RN
- **상태**: 설계 승인됨 → 구현 플랜 작성 대기

---

## 1. 배경 & 범위

기획안의 마지막 정리 묶음. 세 미뤄둔 것 중 **만료 배치 + 모더레이션** 두 가지만(동의 산책 경로 오버레이는 오피스아워가 가치·프라이버시 의문 제기 → 드롭, 실제 신호 보고 후속).

**포함:**
- **만료 배치(pg_cron)**: 신고 14일 자동 만료(active→expired), 알림로그 30일 TTL 삭제.
- **모더레이션(위기 앱 안전)**: 허위 제보 숨김(소유자), 채팅 차단(스토킹), 콘텐츠 신고 기록.

**제외:** 동의 산책 경로 실종 수색 오버레이(드롭), 자동 모더레이션 임계값·rate limit(데이터 보고 후속), 보호자 수동 만료 연장, 관리자 검토 도구.

---

## 2. 만료 배치 (pg_cron)

**마이그레이션 `0013_expiry.sql`**
- `create extension if not exists pg_cron with schema extensions;`
- **`expire_old_reports()`** (security definer): `update public.missing_reports set status='expired', updated_at=now() where status='active' and expires_at < now();`
  - 파생 효과(추가 작업 없음): expired → 기존 RLS로 **연결 채팅 자동 읽기전용**(messages_insert는 active 요구), **flyer 공개 읽기·동네지도·dog 공개 읽기에서 자동 제외**.
- **`purge_old_notification_logs()`** (security definer): `delete from public.notification_logs where created_at < now() - interval '30 days';`
- 스케줄: `cron.schedule('expire-reports','0 3 * * *', $$ select public.expire_old_reports() $$)`, `cron.schedule('purge-notif-logs','30 3 * * *', $$ select public.purge_old_notification_logs() $$)`.
- 두 함수 EXECUTE는 revoke public/anon, grant service_role(cron 실행). 만료 = status 전환만(레코드 보존, 히스토리 유지).

---

## 3. 모더레이션 (데이터 + RLS)

**마이그레이션 `0014_moderation.sql`**

### ① 숨김 (허위 핀)
- `alter table public.sightings add column hidden boolean not null default false;`
- RPC **`hide_sighting(p_sighting_id uuid, p_hidden boolean)`** (security definer, authenticated): 그 제보가 연결된 신고의 **소유자만** `hidden` 토글(컬럼 안전 — 좌표/메모 변경 불가). 비소유자 호출 시 raise.
- `report_sightings` RPC(SP3a 0009) 수정 → `and not s.hidden` (숨긴 제보는 추적 지도·목록에서 제외).

### ② 차단 (스토킹)
- `blocks` 테이블: `id`, `blocker_id`→profiles cascade, `blocked_id`→profiles cascade, `created_at`, **unique(blocker_id, blocked_id)**. RLS: 본인(blocker) 행만 select/insert/delete (`blocker_id=auth.uid()`).
- `messages_insert` RLS에 차단 가드 추가(양방향): 채팅 두 참여자 사이 block 존재 시 전송 거부 —
  `and not exists (select 1 from public.blocks b join public.chats c2 on c2.id = chat_id where (b.blocker_id=c2.owner_id and b.blocked_id=c2.reporter_id) or (b.blocker_id=c2.reporter_id and b.blocked_id=c2.owner_id))`.
- `my_chats` RPC(SP4 0011) 수정 → 내가 차단한 상대 스레드 제외: `and not exists(select 1 from public.blocks b where b.blocker_id=auth.uid() and b.blocked_id = case when c.owner_id=auth.uid() then c.reporter_id else c.owner_id end)`.

### ③ 신고 기록 (검토용, 자동조치 없음)
- `content_flags` 테이블: `id`, `content_type text check in ('sighting','message')`, `content_id uuid`, `reporter_id`→profiles cascade, `reason text`, `created_at`. RLS: 인증 사용자 본인 명의 insert만(`reporter_id=auth.uid()`); 일반 사용자 select 정책 없음(관리자 도구 후속).

모든 정책 `TO authenticated`. 자동 숨김·rate limit 없음(오피스아워: 데이터 보고 후속).

---

## 4. 서비스 · UI

- `src/services/moderation.ts`: `hideSighting(sightingId, hidden)`(rpc), `blockUser(blockedId)`/`unblockUser(blockedId)`(blocks insert/delete), `flagContent(type, id, reason)`(content_flags insert).
- UI 수정:
  - `report/[id]/track.tsx`: 소유자 제보 항목에 "숨김"(hideSighting→refetch) + "신고"(flagContent sighting).
  - `chat/[id].tsx`: 헤더 "차단"(blockUser→입력 비활성/목록서 사라짐), 메시지 롱프레스 "신고"(flagContent message).

---

## 5. 에러 · 테스트

### 에러
- 숨김/차단/신고 실패 → 안내 + 재시도; 차단 후 채팅 입력 비활성(읽기 유지); 만료 SQL은 idempotent(다음 주기 재시도 안전).

### 테스트
- **단위(TDD)**: `moderation.ts`(hideSighting→rpc 인자, blockUser→blocks insert, flagContent→content_flags insert; supabase 목).
- **통합(로컬 Supabase) ⭐**:
  - 만료: `expires_at` 과거 active 신고 → `expire_old_reports()` → `expired`; 그 신고 연결 채팅 메시지 insert 거부(closed); 30일 지난 `notification_logs` → `purge_old_notification_logs()` 삭제.
  - 숨김: 소유자 `hide_sighting(true)` → `report_sightings` 제외; 비소유자 호출 거부.
  - 차단: A가 B 차단 → 둘 사이 메시지 insert 거부 + A `my_chats`에서 스레드 제외.
  - 신고: `content_flags` 본인 insert 기록; 타인 명의 insert 거부.
  - 함수 EXECUTE 잠금(expire/purge anon 거부).
- **수동/실기기**: pg_cron 스케줄 등록 확인(대시보드), UI 숨김/차단/신고.

---

## 6. 의존성 · 미해결
- SP1–SP3b 전제. pg_cron 확장(Supabase 로컬·클라우드 지원).
- **미해결**: 자동 모더레이션 임계값(데이터 보고); 관리자 검토 도구; 보호자 수동 만료 연장; rate limit(앱 전용이라 우선순위 낮음); 차단 시 기존 메시지 보존 여부(현재 보존·읽기전용).
