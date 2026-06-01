# 설계: 멍백홈 — Sub-project 4 「채팅 (보호자 ↔ 제보자 1:1)」

- **작성일**: 2026-06-02
- **방식**: superpowers:brainstorming
- **상위 전략 문서**: `~/.gstack/projects/MeongBackHome/cruel-unknown-design-20260601-224226.md` (office-hours, APPROVED) — 기획안 항목 10 "채팅(앱 사용자 간, closed 정책)"
- **선행**: SP1(profiles·fcm_tokens), SP3a(missing_reports·sightings·notify-nearby Edge Function) — main 병합됨
- **스택**: Expo RN · Supabase(PostgreSQL · **Realtime** · Edge Functions) · FCM
- **상태**: 설계 승인됨 → 구현 플랜 작성 대기

---

## 1. 배경 & 범위

SP3a에서 미룬 **보호자↔제보자 연결**의 실현. 이웃이 목격 제보를 하면, 보호자가 그 제보자와 **1:1 텍스트 채팅**으로 만남을 조율한다. 전화번호 노출 대신 인앱 채팅으로 연결(기존 프라이버시 정책 일관).

**범위 (포함):**
- (신고, 제보자) 쌍당 1개 채팅 스레드, 텍스트 전용 1:1
- 실시간 수신(Supabase Realtime) + **새 메시지 푸시**(Webhook → Edge Function → FCM)
- closed 정책: 신고가 active 아니면(resolved/expired) 읽기 전용
- 채팅 목록, 진입점(보호자=추적 화면 제보 탭, 제보자=신고 상세), 푸시 딥링크
- SP3a의 FCM 발송 로직을 `_shared/fcm.ts`로 추출해 공유

**제외 (YAGNI / 후순위):**
- 이미지·읽음 표시·타이핑 인디케이터·그룹 채팅
- 별도 "내 제보 목록" 화면(채팅 목록이 제보자 입장 스레드도 포함)
- 만료 배치 자체(SP3c) — closed는 report.status 파생으로 동작

---

## 2. 데이터 모델

새 마이그레이션 `0010_chat.sql`(테이블+RLS+트리거+Realtime), `0011_chat_rpc.sql`(생성 RPC).

### `chats` — (report, reporter) 쌍당 1 스레드
| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | uuid PK | |
| `report_id` | uuid NOT NULL → missing_reports ON DELETE CASCADE | |
| `reporter_id` | uuid NOT NULL → profiles ON DELETE CASCADE | 비-소유자 참여자 |
| `owner_id` | uuid NOT NULL → profiles ON DELETE CASCADE | 비정규화 = 신고 소유자 |
| `created_at` | timestamptz NOT NULL default now() | |
| `last_message_at` | timestamptz NOT NULL default now() | 스레드 정렬 |
| 제약 | **UNIQUE(report_id, reporter_id)** | 쌍당 1스레드(멱등 생성) |

### `messages`
| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | uuid PK | |
| `chat_id` | uuid NOT NULL → chats ON DELETE CASCADE | |
| `sender_id` | uuid NOT NULL → profiles ON DELETE CASCADE | chat의 owner 또는 reporter |
| `body` | text NOT NULL | 텍스트 전용 |
| `created_at` | timestamptz NOT NULL default now() | 인덱스 `(chat_id, created_at)` |

### 생성 RPC `get_or_create_chat(p_report_id uuid, p_reporter_id uuid)` (SECURITY DEFINER)
규칙 일원화. 호출자가 **그 신고의 owner이거나, 그 신고에 sighting을 남긴 reporter 본인**일 때만 허용. 기존 스레드 있으면 반환, 없으면 생성(owner_id는 report에서 채움). 양쪽 진입점에서 호출. UNIQUE 제약으로 동시성 멱등.

### RLS
- **`chats`**: SELECT = `auth.uid() in (owner_id, reporter_id)`. 직접 INSERT/UPDATE/DELETE 정책 없음 — 생성은 RPC로만(EXECUTE는 authenticated; 함수 내부에서 권한 검증).
- **`messages`**:
  - SELECT = 참여자: `exists(select 1 from chats c where c.id = chat_id and auth.uid() in (c.owner_id, c.reporter_id))`.
  - INSERT with check = 보낸이 본인 + 참여자 + **신고 active**: `sender_id = auth.uid() and exists(select 1 from chats c join missing_reports r on r.id = c.report_id where c.id = chat_id and auth.uid() in (c.owner_id, c.reporter_id) and r.status = 'active')`.
  - 읽기는 closed 후에도 허용.
- **`notification_logs`**: Edge Function이 service role로 기록(기존).

### 트리거 / Realtime
- `messages` AFTER INSERT 트리거 → `chats.last_message_at = now()`.
- `messages`를 Supabase Realtime publication에 추가. 클라이언트는 `chat_id` 필터로 INSERT 구독(Realtime이 RLS 인지 → 참여자만 수신).

### closed 정책
`report.status != 'active'` → 메시지 INSERT가 RLS로 차단(읽기 전용). 화면은 입력창 비활성 + 배너.

---

## 3. 알림 아키텍처 (SP3a 재사용 + 공통화)

- `supabase/functions/_shared/fcm.ts` — 서비스계정 JWT(RS256, crypto.subtle), FCM HTTP v1 발송, `notification_logs` 기록, 무효 토큰 정리(`details[].errorCode`만), 로그 빌더. **SP3a notify-nearby의 인라인 로직을 추출**; notify-nearby는 이걸 import하도록 리팩터(기존 Deno 테스트 유지).
- `supabase/functions/notify-message/index.ts`: Database Webhook on `messages` INSERT → payload.record(chat_id, sender_id, body) → chat 로드 → **수신자 = 참여자 중 sender 아닌 쪽** → 수신자 `fcm_tokens`로 FCM. notification = "새 메시지가 도착했어요"(본문 미노출, 프라이버시) + data `{type:'chat_message', chat_id, report_id}`.
- 딥링크: `src/lib/pushNav.ts` 확장 — `type==='chat_message'` → `/(app)/chat/[chat_id]`.

---

## 4. 화면 + 진입점

- **채팅 스레드** (`app/(app)/chat/[id].tsx`): 메시지 버블 목록 + 입력창·전송. 진입 시 과거 메시지 로드 + Realtime 구독. active면 입력 가능, closed면 입력 비활성 + "종료된 신고예요(읽기 전용)" 배너.
- **채팅 목록** (`app/(app)/chats.tsx`): 내가 참여한 스레드(소유자·제보자 양쪽), `last_message_at` 정렬, 상대 닉네임 + 마지막 시각. 홈에 "채팅" 진입점.
- **진입점**: 보호자 = 추적 지도(`report/[id]/track.tsx`)의 제보 항목에 "대화" → `getOrCreateChat(report, 제보자)`. 제보자 = 신고 상세(`report/[id]/index.tsx`)에서 내가 제보했으면 "보호자와 대화" → `getOrCreateChat(report, 나)`.
- **서비스** `src/services/chats.ts`: `getOrCreateChat(reportId, reporterId)`(rpc), `listMyChats()`, `listMessages(chatId)`, `sendMessage(chatId, body)`, `subscribeToChat(chatId, onInsert)`(Realtime 핸들 반환).

---

## 5. 에러 처리 · 안전 · 테스트

### 에러/엣지
- 전송 실패 → 입력 유지 + 재시도. closed → 입력 비활성 + RLS 거부(이중). Realtime 끊김 → 재구독 시 최근 메시지 재조회. 동시 생성 → UNIQUE + RPC 멱등. 빈/공백 메시지 차단. 푸시 개별 실패·무효 토큰 → `_shared/fcm.ts` 처리.

### 테스트
- **단위(TDD)**: `message.ts`(빈/공백 거부·trim) / `chats.ts`(getOrCreateChat rpc, sendMessage insert, listMessages, listMyChats — supabase 목).
- **통합(로컬 Supabase) ⭐**: RLS — 참여자만 읽기/쓰기, 비참여자 거부; **closed(resolved) 신고는 INSERT 거부·읽기 허용**; `get_or_create_chat` owner/제보자만·재호출 멱등·낯선 사람 거부; `last_message_at` 트리거 갱신.
- **Edge Function**: `_shared/fcm.ts` 순수 로직 Deno 테스트 + 수신자 선정(sender 아닌 참여자) 단위 테스트. notify-nearby 리팩터 후 기존 Deno 테스트 통과.
- **수동/실기기**: 2기기 실시간 주고받기 + 푸시 수신 + 딥링크 + closed 읽기전용.

---

## 6. 의존성 · 미해결
- SP1(profiles·fcm_tokens), SP3a(missing_reports·sightings·notify-nearby·pushNav) 전제.
- Supabase Realtime 활성화(messages publication) + Database Webhook(messages insert → notify-message).
- **미해결**: Realtime 로컬 개발 검증 방법(또는 통합 테스트는 폴링/직접 insert로 대체); 메시지 페이지네이션(초기엔 전체 로드, 길어지면 SP later); 차단/신고(악용 대응)는 SP3c 모더레이션과 함께.
