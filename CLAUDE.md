# Project Instructions

## Project: SKKU 2.5D Indoor Navigation

캡스톤 디자인 프로젝트 — SKKU 자연과학캠퍼스 제1공학관 2.5D 실내 내비게이션 + 360° Walkthrough

### Key Documents (반드시 읽고 작업할 것)
- **엔지니어링 플랜**: `~/.claude/plans/shimmying-dancing-blanket.md` — 아키텍처, 스케줄, 테스트 계획, 디자인 명세 포함
- **디자인 시스템**: `DESIGN.md` — 색상 팔레트(hex), 레이아웃, 인터랙션 상태, 비디오 플레이어 패턴
- **디자인 원본**: `~/.gstack/projects/skku-indoor-nav/poiso-unknown-design-20260326-165933.md`

### Architecture Summary
- Frontend: Maptalks + 2.5D-Indoor-Maps + Three.js (기존 코드: `Maptalk-test/`)
- Backend: Java Spring Boot (A* pathfinding, 임형준 담당)
- 360° Video: Three.js SphereGeometry + VideoTexture (프로토타입: `360-test/`)
- API: GET /api/route?from={nodeId}&to={nodeId} → path + edges + clip list

### Critical Decisions
- 벽만 BufferGeometry merge, 방 바닥은 room_type별 그룹화 (draw calls ~10)
- MeshStandardMaterial + lighting (metalness: 0.1, roughness: 0.85)
- 비디오: Apple Look Around 패턴 (상하 분할, 전체화면 전환 가능)
- 색상: ROOM_COLORS 룩업 테이블 (DESIGN.md 참조)
- 검색: 자동완성에 "21517 (5F, 교실)" 형태로 층+유형 표시
- VideoTexture 클립 전환 시 .dispose() 필수

## gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

### Available gstack skills

- `/browse` — Headless browser for QA and testing


### Save the Token: Dont use AGENT
PLEASE DON'T USE AGNET. They are very very expensive.
Agent need only the situation which very complicated and multiprocessing needed.