# SKKU 2.5D Indoor Navigation — 배포 가이드

이 문서는 프론트엔드를 Vercel에 배포하는 절차를 처음부터 끝까지 따라할 수 있도록 정리한 런북입니다.
백엔드(Spring Boot) 호스팅과 360° 영상 호스팅은 별도 결정 사항이라 11, 12장에 placeholder로 남겨둡니다.

---

## 1. 사전 준비물

- GitHub 계정 + 이 레포가 push 되어 있어야 함 (현재 `main` 브랜치 기준)
- Vercel 계정 ([https://vercel.com/signup](https://vercel.com/signup) — GitHub 로그인 권장)
- Node.js 20.x 이상, npm 10.x 이상 (로컬 테스트용)
- 로컬에서 `npm install` 한 번 돌려서 의존성이 모두 설치된 상태

> ⚠️ Node 18 이하는 `cross-env`, `terser-webpack-plugin` 일부 옵션에서 경고가 날 수 있으니 가급적 20.x 사용을 권장.

---

## 2. 로컬 사전 점검 (push 전에 반드시 실행)

배포용 빌드가 깨끗하게 떨어지는지 확인합니다. 한 번이라도 실패하면 push 하지 마세요.

```bash
cd 2.5d_indoor_navigation_frontend_v2
npm install
npm run build:prod
```

빌드가 성공하면 다음을 확인:

```bash
# 1) editor 코드가 dist/에 안 들어갔는지
grep -r graphEditor dist/         # 결과 없어야 함
grep -r setupGraphEditor dist/    # 결과 없어야 함
grep -r apiModeBadge dist/        # 결과 없어야 함

# 2) sourcemap이 안 나왔는지 (있으면 .ts 원본이 그대로 노출됨)
ls dist/*.map 2>/dev/null         # "No such file or directory"가 나와야 정상

# 3) 콘솔 로그 스트립 확인
grep -c "console\.log" dist/bundle.*.js   # 0 또는 1 (vendor 안에 1개 정도는 OK)

# 4) editor 청크 파일이 통째로 빠졌는지
ls dist/*.bundle.*.js
# bundle.<hash>.js (메인) + 85.bundle.<hash>.js (mobile chunk) 두 개만 있어야 정상
# 8.bundle.<hash>.js (editor chunk)이 있으면 → DefinePlugin 작동 안 함
```

빠른 스모크 테스트:

```bash
npx serve dist -p 3000
# 브라우저에서 http://localhost:3000 접속
# - 지도 떠야 함
# - 우상단에 "Graph Editor (Dev)" 버튼 없어야 함
# - 우측 하단에 FPS 표시 없어야 함
# - LOCAL/API 토글 뱃지 없어야 함
# - Ctrl+Alt+R 눌러도 아무 일 안 일어나야 함 (DevTools 콘솔 로그 없음)
```

---

## 3. Vercel 프로젝트 만들기

1. [https://vercel.com/new](https://vercel.com/new) 접속
2. **Import Git Repository** 에서 이 레포 선택
3. **Configure Project** 화면에서:
   - **Project Name**: 자유 (예: `skku-indoor-nav`)
   - **Framework Preset**: `Other` (Vite/Next 자동 감지가 잘못 동작할 수 있으니 명시적으로 Other)
   - **Root Directory**: `2.5d_indoor_navigation_frontend_v2/` ← 중요. 레포 루트가 아님.
   - **Build and Output Settings** (펼쳐서 직접 입력):
     - Build Command: `npm run build:prod`
     - Output Directory: `dist`
     - Install Command: `npm install`

> 위 설정은 `vercel.json`에도 같이 적혀 있어서 Vercel이 자동으로 읽습니다. UI에서 한번 더 확인하세요.

---

## 4. 환경 변수 설정 (Vercel)

Project → Settings → Environment Variables 로 이동.

| Name             | Value                                  | Environment            |
|------------------|----------------------------------------|------------------------|
| `API_BASE_URL`   | (백엔드 미정 시) 빈 값으로 두거나 placeholder | Production, Preview    |
| `VIDEO_BASE_URL` | (영상 호스팅 미정 시) 빈 값                  | Production, Preview    |

**`PROD_BUILD`은 Vercel에 등록할 필요 없습니다.** `npm run build:prod` 스크립트 안에 `cross-env PROD_BUILD=true`가 들어있어서 빌드 시점에 자동으로 세팅됩니다.

> `API_BASE_URL`을 비워두면 프론트엔드가 same-origin 상대 경로 `/api`로 fallback 합니다. 즉 일단 배포는 되지만 API 호출은 모두 404가 납니다. 백엔드가 올라간 뒤 8장 절차대로 갱신하세요.

---

## 5. 첫 배포

1. Vercel에서 **Deploy** 클릭 (또는 `main` 브랜치 push)
2. Build Logs 탭에서 진행 상황 확인. `npm run build:prod` 명령이 보이고 마지막에 `compiled with N warnings` 가 떠야 정상.
   - asset size warning 2개는 무시 가능 (room_codes.json + main bundle이 244 KiB 초과 — three.js + maplibre-gl 때문)
3. 배포 완료되면 `https://<project>.vercel.app` URL이 활성화됨. 클릭해서 접속.

---

## 6. 커스텀 도메인 (선택)

1. Project → Settings → Domains
2. **Add** 클릭, 도메인 입력 (예: `nav.skku.example.com`)
3. Vercel이 알려주는 DNS 레코드(보통 CNAME)를 도메인 등록자 쪽에 추가
4. DNS 전파(보통 몇 분~몇 시간) 후 자동으로 HTTPS 인증서 발급

---

## 7. 배포 후 검증 체크리스트

배포된 URL을 브라우저로 열고 DevTools(F12)를 켠 뒤:

- [ ] **Network 탭**: 첫 페이지 로딩 시 `8.bundle.*.js` (editor 청크) 요청이 **없어야** 함. `bundle.*.js` (메인), `85.bundle.*.js` (mobile, 모바일 기기일 때만) 두 개만 보여야 함.
- [ ] **Sources 탭**: `webpack://` 트리 아래에 `.ts` 원본 파일이 보이지 **않아야** 함 (sourcemap 비활성화 확인). 미니파이된 `.js`만 있어야 함.
- [ ] **Console 탭**: 페이지 진입 시 `[Component] ...` 형태의 로그가 출력되지 **않아야** 함 (drop_console 작동 확인).
- [ ] **UI**:
  - 우상단 헤더에 "Graph Editor (Dev)" 버튼 없음
  - 우측 하단 FPS 표시 없음
  - 좌측 어딘가에 LOCAL/API 모드 뱃지 없음
- [ ] **키보드**: `Ctrl+Alt+R` 눌렀을 때 아무 반응 없어야 함
- [ ] **API 호출 (백엔드 배포 후)**: Network 탭에서 `/api/route?...` 가 백엔드 도메인으로 가고 200 응답 떨어져야 함

---

## 8. 백엔드 올라간 후 환경 변수 갱신

백엔드 호스팅이 결정되고 URL이 생기면:

1. Vercel → Project → Settings → Environment Variables
2. `API_BASE_URL`을 백엔드 절대 URL로 수정 (예: `https://skku-nav-api.example.com/api`)
3. **저장만 해서는 반영 안 됨.** Deployments 탭으로 가서 가장 최근 deployment의 `...` 메뉴 → **Redeploy** 클릭 (코드 변경 없이 환경 변수만 다시 주입해서 빌드)
4. 백엔드 쪽 CORS 허용 도메인에 Vercel URL 추가 (`https://<project>.vercel.app` + 커스텀 도메인 있으면 그것도)

---

## 9. 롤백

뭔가 잘못 배포됐을 때:

1. Vercel → Deployments 탭
2. 정상 동작했던 이전 deployment 우측 `...` 메뉴 → **Promote to Production**
3. 즉시 그 빌드로 트래픽이 전환됨 (rebuild 없이)

---

## 10. 트러블슈팅

| 증상                                             | 원인 / 해결                                                       |
|--------------------------------------------------|------------------------------------------------------------------|
| 로컬에선 빌드 되는데 Vercel에서만 실패            | Node 버전 차이. `package.json`에 `"engines": { "node": "20.x" }` 추가 |
| 페이지는 뜨는데 새로고침하면 404                  | SPA fallback 누락. `vercel.json`의 `rewrites` 룰 확인              |
| 지도 타일은 뜨는데 길찾기 API가 CORS 에러         | 백엔드 CORS 허용 목록에 Vercel 도메인 추가 안 됨                   |
| `*.geojson` 다운받을 때 `application/json`이 아닌 MIME으로 옴 | `vercel.json`에 `headers` 추가하거나 백엔드 reverse proxy 통해 서빙 |
| `Graph Editor (Dev)` 버튼이 prod에 보임            | `IS_PROD_BUILD`가 `true`로 안 박혔다는 뜻. Vercel build log에서 `cross-env PROD_BUILD=true` 라인 확인. 없으면 빌드 명령이 `npm run build:prod`가 아니라 `npm run build`로 들어간 것 |

---

## 11. 백엔드 배포 (TBD)

> 결정 안 된 사항. Spring Boot API를 어디에 올릴지 정해지면 이 섹션을 채울 것.

후보:
- **Railway** — Dockerfile 또는 Nixpacks, Postgres 같이 묶어서 약 $5/mo
- **Fly.io** — Docker, free tier 넉넉
- **VPS (Oracle Free / 학교 서버)** — 직접 nginx + systemd, 비용 0이지만 운영 부담

채워야 할 항목:
- Dockerfile 위치 및 빌드 명령
- 환경 변수 (DB URL, allowed-origins 등)
- 백엔드 도메인 → Vercel `API_BASE_URL` 갱신 절차 (8장 참조)

---

## 12. 영상 호스팅 (TBD)

> 결정 안 된 사항. 17 GB의 360° 워크스루 영상을 어디에 올릴지 정해지면 이 섹션을 채울 것.

가장 권장: **Cloudflare R2** (egress 무료, 17 GB 저장 약 $0.26/월). 다른 후보로 AWS S3 + CloudFront, 백엔드와 동일 호스트.

채워야 할 항목:
- R2 버킷 생성 및 public access 설정
- 영상 업로드 명령 (rclone / aws-cli)
- 커스텀 도메인 연결
- Vercel `VIDEO_BASE_URL` 환경 변수 갱신 (8장과 같은 절차)

---

## 부록: 빌드 모드 정리

| 명령                | 모드            | editor 포함 | 디버그 UI 포함 | sourcemap | 용도                |
|---------------------|-----------------|------------|---------------|-----------|---------------------|
| `npm run dev`       | development     | ✅          | ✅             | inline    | 로컬 개발            |
| `npm run build`     | production-dev  | ✅          | ✅             | external  | 내부 테스트 빌드     |
| `npm run build:prod`| production-real | ❌          | ❌             | ❌         | 외부 배포 (Vercel)   |
