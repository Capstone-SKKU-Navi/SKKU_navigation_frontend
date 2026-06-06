# Production Backend Setup

작성일: 2026-06-05

이 문서는 현재 프론트엔드 production 빌드가 기대하는 백엔드 API와 배포 설정을 정리한다. 백엔드 코드는 수정하지 않는 전제로 작성했다.

## 요약

프론트엔드는 Vercel에 정적 사이트로 배포하고, Spring Boot 백엔드는 별도 호스트에서 실행한다. Vercel 빌드에는 `API_BASE_URL`만 정확히 주입하면 된다.

```text
Browser
  -> Vercel static frontend
  -> API_BASE_URL=https://{backend-host}/api
  -> Spring Boot backend
  -> PostgreSQL/PostGIS
  -> local/server video files from video_files.file_path
```

## 프론트엔드 배포 설정

Vercel 프로젝트 루트:

```text
SKKU-2.5D-Navigation_frontend/2.5d_indoor_navigation_frontend_v2
```

현재 production deployment:

```text
https://25dindoornavigationfrontendv2.vercel.app
```

현재 `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "npm run build:prod",
  "outputDirectory": "dist",
  "installCommand": "npm install",
  "framework": null,
  "rewrites": [
    { "source": "/((?!geojson|strings|images|api).*)", "destination": "/index.html" }
  ]
}
```

`.vercelignore`는 반드시 유지한다. 이 프로젝트 폴더에는 `videos.zip`가 약 23GB라서, 제외하지 않으면 Vercel 업로드 제한에 걸린다.

```text
node_modules
dist
videos
videos.zip
```

Vercel 환경 변수:

| 이름 | 예시 | 설명 |
|---|---|---|
| `API_BASE_URL` | `https://skku-nav.duckdns.org/api` | Spring Boot API base. 끝에 `/api` 포함 |
| `VIDEO_BASE_URL` | 비움 | 비우면 자동으로 `${API_BASE_URL}/videos` 사용 |

2026-06-06 현재 Vercel production에는 `API_BASE_URL=https://skku-nav.duckdns.org/api`가 설정되어 있다.

백엔드 URL을 바꿀 때는 PowerShell에서 아래처럼 기존 env를 교체하고 재배포한다.

```powershell
Set-Content -LiteralPath .vercel_api_base.tmp -Value "https://{backend-host}/api" -NoNewline -Encoding ascii
npx vercel env rm API_BASE_URL production --yes
cmd /c "type .vercel_api_base.tmp | npx vercel env add API_BASE_URL production"
Remove-Item -LiteralPath .vercel_api_base.tmp -Force
npx vercel deploy --prod
```

Vercel 공식 문서 기준으로 build-time 환경 변수는 Vercel Project Settings 또는 CLI `--build-env`로 빌드 단계에 주입된다. 이 프로젝트는 webpack `DefinePlugin`이 값을 번들에 박아 넣으므로 환경 변수 변경 후 재배포가 필요하다.

참고:
- https://vercel.com/docs/cli/deploy
- https://vercel.com/docs/cli/build

## Production Frontend 동작

`npm run build:prod`로 빌드하면:

- Graph editor dynamic import가 제거된다.
- API mode가 기본값으로 켜진다.
- 시작 시 `GET {API_BASE_URL}/geojson/all`로 지도 데이터를 가져온다.
- 경로 검색은 `POST {API_BASE_URL}/route`를 호출한다.
- 방 검색은 `GET {API_BASE_URL}/rooms/search?q=...`를 호출한다.
- 영상 재생은 `{API_BASE_URL}/videos/{filename}`를 사용한다.
- 누락 영상 표시는 백엔드 목록 API 없이, 경로 응답의 `videoFile`만 `GET {API_BASE_URL}/videos/{filename}` + `Range: bytes=0-0`로 확인한다. 404/410이면 누락으로 표시하고, 확인이 애매하면 플레이어의 기존 error/gap 처리에 맡긴다.

## 필요한 백엔드 API

현재 Spring Boot 코드 기준으로 프론트가 사용하는 API:

| Method | Path | 용도 | 구현 위치 |
|---|---|---|---|
| `GET` | `/api/geojson/all` | 모든 건물 GeoJSON FeatureCollection | `GeojsonController` |
| `POST` | `/api/route` | 좌표 기반 경로 계산 + walkthrough clips | `RouteController` |
| `GET` | `/api/videos/{filename}` | 360도 영상 Range 스트리밍 | `VideoController` |

`/api/videos-list`는 개발 서버 전용이다. Production backend에 추가하지 않아도 된다.

방 검색/자동완성은 production에서도 프론트가 `GET /api/geojson/all`로 받은 room feature 목록에서 로컬로 처리한다. 백엔드의 `GET /api/rooms/search`는 현재 코드에 존재하지만, 배포용 프론트의 필수 API는 아니다.

## CORS

백엔드 `application.yml`의 `cors.allowed-origins`는 배포된 Vercel URL을 포함해야 한다.

```yaml
cors:
  allowed-origins: ${CORS_ALLOWED_ORIGINS:http://localhost:8082,http://localhost:3000}
```

운영 예시:

```bash
CORS_ALLOWED_ORIGINS=https://skku-nav.vercel.app,https://skku-nav-git-main-{team}.vercel.app
```

Preview 배포를 자주 쓴다면 Vercel preview URL까지 허용하거나, 운영 검증용으로 production domain만 사용한다.

## 데이터 요구사항

PostgreSQL에는 Flyway 마이그레이션 후 아래 테이블 데이터가 들어 있어야 한다.

| 테이블 | 프론트 영향 |
|---|---|
| `geojson_files` | 지도/층/방 렌더링 |
| `nav_nodes` | 방 검색, 경로 endpoint |
| `nav_edges` | 경로 계산과 영상 클립 계산 |
| `video_files` | 영상 파일 경로와 yaw |

특히 `video_files.file_path`는 백엔드 서버가 실제로 읽을 수 있는 절대경로여야 한다. Vercel에는 대용량 영상을 올리지 않는다.

## 백엔드 실행 체크리스트

1. PostgreSQL/PostGIS 실행
2. Spring Boot 실행 시 Flyway migration 성공 확인
3. 데이터 import 실행
4. `GET /api/geojson/all`이 `FeatureCollection` 반환
5. `POST /api/route`가 `found=true`와 `walkthrough.clips` 반환
6. `GET /api/videos/{filename}`이 `206 Partial Content` 반환
7. Vercel URL에서 CORS 오류가 없는지 확인

## 운영 배포 순서

1. 백엔드 호스트를 먼저 준비한다.
2. 백엔드에 DB와 영상 파일 접근 권한을 구성한다.
3. `CORS_ALLOWED_ORIGINS`에 Vercel production URL을 넣는다.
4. Vercel 프로젝트 환경 변수 `API_BASE_URL=https://{backend-host}/api`를 설정한다.
5. Vercel에서 production redeploy를 실행한다.
6. 배포 URL에서 방 검색과 경로 검색을 확인한다.

## 알려진 주의점

- `API_BASE_URL`은 빌드 타임 값이다. 변경하면 재배포가 필요하다.
- production 빌드는 API mode로 시작하므로 백엔드가 꺼져 있으면 로딩 화면에서 API 오류가 보인다.
- 누락 영상 사전 확인은 `Range: bytes=0-0` 요청을 사용한다. 백엔드 또는 프록시가 `Range` 요청을 막으면 사전 회색 표시는 제한될 수 있지만, 이 경우에도 플레이어는 실제 재생 실패를 gap으로 처리한다.
- 현재 번들에는 정적 GeoJSON도 포함된다. production 초기 로드는 API를 사용하지만, 번들 크기 최적화를 원하면 다음 단계에서 정적 GeoJSON 복사를 production에서 더 줄일 수 있다.
