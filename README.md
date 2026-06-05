# SKKU 2.5D Indoor Navigation

성균관대학교 자연과학캠퍼스 실내 길찾기 웹앱. 2.5D 실내 지도에서 방을 검색하고, 백엔드 API 기반 경로와 360도 워크스루를 확인합니다.

[![Status](https://img.shields.io/website?url=https%3A%2F%2F25dindoornavigationfrontendv2.vercel.app&label=status&up_message=online&down_message=offline)](https://25dindoornavigationfrontendv2.vercel.app)

**[페이지](https://25dindoornavigationfrontendv2.vercel.app)**

---

## 사용 방법

- 출발 핀과 도착 핀을 지도 위로 드래그합니다.
- 출발지와 도착지가 정해지면 경로를 확인합니다.
- 2D/3D 전환과 층 선택으로 경로를 살펴봅니다.
- 영상이 있는 구간은 360도 워크스루로 확인합니다.

## Quickstart

```bash
cd 2.5d_indoor_navigation_frontend_v2
npm install
npm run dev
```

개발 서버: `http://localhost:8082`

## Production

```bash
cd 2.5d_indoor_navigation_frontend_v2
npm run build:prod
npx vercel deploy --prod
```

Vercel 환경 변수:

```text
API_BASE_URL=https://{backend-host}/api
```

`VIDEO_BASE_URL`은 비워두면 `${API_BASE_URL}/videos`를 사용합니다.

## Docs

- [배포/백엔드 구성](2.5d_indoor_navigation_frontend_v2/docs/PRODUCTION_BACKEND_SETUP.md)
- [모바일 UI](docs/MOBILE.md)
- [그래프 에디터](docs/GRAPH_EDITOR.md)
- [영상 네이밍](docs/VIDEO_NAMING.md)
- [API 명세](docs/BACKEND_API.md)
