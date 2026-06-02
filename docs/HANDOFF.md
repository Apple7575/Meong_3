# 다른 컴퓨터에서 이어받기 (Handoff)

## 핵심: 프로젝트의 "진짜 상태"는 이 맥에 없다

| 무엇 | 어디에 사는가 | 이 맥과의 관계 |
|---|---|---|
| 코드 + 커밋 + 설계문서 | **GitHub** `Apple7575/Meong_3` (main) | clone만 하면 됨 |
| 백엔드 (DB·함수·웹훅·cron) | **Supabase 클라우드** `ncvpijihbmpnwvqdomzg` | 항상 켜져 있음, 맥 무관 |
| 앱 빌드 | **EAS** (Expo 계정 `shawn777`) | expo.dev에서 어디서나 확인 |

→ 다른 컴퓨터에선 **clone + 로그인 몇 개 + 로컬 파일 2개**만 갖추면 그대로 이어집니다.

## 새 컴퓨터 셋업 체크리스트

```bash
# 1. 코드 받기
git clone https://github.com/Apple7575/Meong_3.git
cd Meong_3
npm install                      # .npmrc(legacy-peer-deps) 덕에 그냥 됨

# 2. CLI 도구
npm i -g eas-cli                 # supabase는 npx로 씀 (npx supabase ...)

# 3. 로그인 (새 기기마다 다시 해야 함)
npx supabase login               # 토큰 발급
eas login                        # 이메일+비번 (구글버튼 말고)

# 4. Supabase 클라우드 링크
npx supabase link --project-ref ncvpijihbmpnwvqdomzg
```

### 로컬에만 있고 git에 없는 파일 2개 (gitignore됨)
1. **`.env`** — 로컬 테스트(`npm run test:rls`) + 로컬 개발용. `.env.example` 복사해서 로컬 Supabase 키 채움. **앱 빌드엔 불필요**(클라우드 값은 `eas.json`에 있음).
2. **`google-services.json`** — Firebase Android 설정. **EAS 시크릿에 이미 올라가 있어 클라우드 빌드(`eas build`)엔 불필요.** 로컬 `expo run:android` 할 때만 필요 → Firebase 콘솔에서 다시 받거나 이 맥에서 복사.

### 로컬에서 통합테스트 돌리려면 (선택)
```bash
# Docker 런타임 (맥): colima 또는 Docker Desktop
brew install colima docker && colima start
npx supabase start               # 로컬 스택
npx supabase db reset            # 마이그레이션 0001~0014 로컬 적용
npm run test:rls                 # 35개 통합테스트
```

### 빌드는 어디서나
```bash
eas build -p android --profile development   # APK (실기기 dev client)
```
빌드는 EAS 서버에서 도니까 컴퓨터 사양/OS 무관. 진행상황은 https://expo.dev/accounts/shawn777/projects/meongbackhome/builds 에서 확인.

## Claude Code 대화는 어떻게 되나?

**대화 기록 자체는 컴퓨터 간 자동 동기화가 안 돼요** (Claude Code가 각 기기 로컬 `~/.claude/`에 저장). 하지만 **중요한 맥락은 전부 git에 커밋돼 있어서** 새 기기의 새 대화로도 바로 이어집니다:

- **`CLAUDE.md`** — 배포 상태 + 런북(어디까지 했고 뭐가 남았는지). Claude Code가 세션 시작 시 자동으로 읽음.
- **`docs/superpowers/specs/`, `docs/superpowers/plans/`** — 각 기능(SP1~SP3c)의 설계·구현 계획. 결정 이유까지 다 들어있음.
- **git log** — 무엇을 왜 했는지 커밋마다 기록.

### 새 컴퓨터에서 Claude Code 시작하는 법
1. clone한 폴더에서 `claude` 실행
2. 첫 메시지로: **"CLAUDE.md랑 docs/superpowers/ 읽고 지금까지 상황 파악해줘. 멍백홈 앱 배포 이어서 할 거야."**
3. 그러면 현재 상태(백엔드 배포 완료, 안드로이드 빌드 진행 중, 카카오 보류, iOS 미설정 등)를 파악하고 이어감.

> 정확히 이 대화창을 그대로 옮기고 싶다면: 이 맥의 `~/.claude/projects/-Users-cruel-Desktop-Projects-MeongBackHome/*.jsonl`이 대화 원본이지만, 경로(사용자명/폴더)가 기기마다 달라 그대로 복사하면 잘 안 맞아요. 권장하지 않고, 위 "CLAUDE.md 읽기" 방식이 더 깔끔합니다.

## 지금 상태 요약 (2026-06-02)
- ✅ 백엔드 클라우드 완전 배포 (마이그레이션 0001~0014, 함수 3개, 웹훅 2개, pg_cron, 시크릿 2개)
- ✅ 앱 클라우드 연결(eas.json) + EAS 프로젝트 + 로그인
- 🔄 안드로이드 dev-client 빌드 진행 중 (build `20ebcbef`)
- ⏸️ 카카오 로그인 보류 (이메일 로그인만; 패키지 제거, `signInWithProvider`는 auth.ts에 남겨둠)
- ⏸️ iOS 미설정 (Apple 개발자 계정 + GoogleService-Info.plist + APNs 키 필요)
- ⏳ 빌드 성공 후: 실기기 QA (가입→강아지 등록→산책/지도/제보/채팅/알림)
