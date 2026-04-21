# Security Incident Response (2026-04-21)

이 문서는 API/토큰 유출 의심 상황에서 Moodtune 프로젝트를 안전 상태로 되돌리기 위한 즉시 대응 절차입니다.

## 1) 즉시 차단 (완료 조건: 기존 키/토큰 무효화)

1. OpenAI 키 삭제 후 신규 키 발급
2. Gemini 키 삭제 후 신규 키 발급
3. Spotify 개발자 앱 시크릿 재발급
4. Vercel Personal/Team Token 전면 재발급
5. 서드파티 앱 연동 토큰(예: GitHub Actions Secret, CI/CD Bot) 재발급

주의:
- 재발급 전에 기존 키를 먼저 폐기합니다.
- 재발급된 값은 절대 `EXPO_PUBLIC_*`로 넣지 않습니다.

## 2) Vercel Env 전면 교체

전체 환경(Production/Preview/Development)의 기존 env를 삭제 후 신규 값으로 재등록합니다.

필수 env:
- `GEMINI_API_KEY` (server-only)
- `GEMINI_PROXY_ALLOWED_ORIGINS` (comma-separated allowlist)
- `GEMINI_PROXY_RATE_LIMIT_PER_MINUTE`
- `GEMINI_PROXY_MAX_RPD`
- `EXPO_PUBLIC_SPOTIFY_CLIENT_ID`
- `EXPO_PUBLIC_GEMINI_PROXY_URL_DEV`
- `EXPO_PUBLIC_GEMINI_PROXY_URL_PROD`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

권장 실행(예시):
```bash
vercel env ls
vercel env rm GEMINI_API_KEY production
vercel env rm GEMINI_API_KEY preview
vercel env rm GEMINI_API_KEY development
vercel env add GEMINI_API_KEY production
vercel env add GEMINI_API_KEY preview
vercel env add GEMINI_API_KEY development
```

## 3) 강제 재배포

목표: 캐시/이전 빌드 산출물에서 구 키 참조 가능성을 제거.

```bash
vercel --prod --force
```

추가 권장:
- Preview도 전체 재배포
- 필요 시 문제된 배포를 Vercel 대시보드에서 직접 Disable/Remove

## 4) 코드/히스토리 유출 점검

실행 순서:
```bash
npm run security:scan-secrets
git log --all --oneline -- .env
git rev-list --all | wc -l
```

체크 포인트:
- `.env`, `.env.local`, `.vercel`이 Git 추적 대상이 아닌지 확인
- 과거 커밋에 실키 문자열(AIza..., sk-...)이 포함되지 않았는지 확인
- 번들 산출물(`dist`)에 secret이 하드코딩되지 않았는지 확인

## 5) 아키텍처 가드레일

원칙:
- 클라이언트(React Native/Web)에서 provider key를 직접 사용하지 않음
- AI 호출은 반드시 `/api/gemini-recommend` 서버 경유
- Spotify OAuth는 PKCE 기반으로 진행하고, 클라이언트에 `client_secret` 주입 금지

현재 저장소 반영 상태:
- `src/api/spotify.service.ts`에서 `client_secret` 전송 제거
- `.env`에서 `EXPO_PUBLIC_GEMINI_API_KEY` 제거
- `.env.example` 추가 (안전한 템플릿)
- 시크릿 패턴 스캐너 추가 (`npm run security:scan-secrets`)

## 6) 사고 후 검증 체크리스트

1. 신규 키 적용 후 API 정상 동작 확인
2. 로그에서 401/403 급증 여부 확인
3. Vercel Audit Log에서 의심 접근/토큰 사용 기록 확인
4. GitHub(또는 원격 저장소)의 push 시점 전후 외부 접근 기록 확인
5. 팀원 로컬의 구 `.env` 파기 여부 확인

## 7) 재발 방지

- CI에 `npm run security:scan-secrets`를 필수 단계로 추가
- PR 템플릿에 "EXPO_PUBLIC에 secret 미포함" 체크 항목 추가
- 월 1회 키 순환(rotate) 정책 운영
