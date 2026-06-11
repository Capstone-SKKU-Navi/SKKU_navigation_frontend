# 피드백 Google Form 작성 및 연결 가이드

SKKU 2.5D Navigation의 `피드백` 버튼은 Google Form URL이 설정되어 있으면 새 탭으로 폼을 엽니다. 사용자가 버튼을 누른 뒤 고르는 것은 최대 1개의 메뉴 버튼이고, `방/지도 오류`만 지도에서 문제 위치를 한 번 찍도록 되어 있습니다.

## 추천 피드백 흐름

1. 사용자가 앱에서 `피드백` 버튼을 누릅니다.
2. 사용자가 문제 종류를 고릅니다.
   - `방/지도 오류`: 지도에서 문제가 있는 방 또는 위치를 한 번 누릅니다.
   - `경로 오류`: 현재 출발/도착 상태를 문제 대상으로 넘깁니다.
   - `영상 오류`: 현재 열려 있는 360도 영상 구간을 문제 대상으로 넘깁니다.
   - `기타`: 일반 피드백으로 엽니다.
3. Google Form에서는 사용자가 “무엇이 이상했는지”만 짧게 씁니다.

이 방식은 현재 화면 상태를 무조건 첨부하지 않습니다. 대신 사용자가 문제 종류를 고르거나 지도 위치를 직접 찍는 시점의 문맥만 첨부합니다.

## Google Form 문항 구성

폼 제목:

```text
SKKU 2.5D Navigation 오류/피드백 제보
```

설명:

```text
방 위치, 방 모양, 경로, 360도 영상, 검색/UI 문제를 알려주세요.
앱에서 자동 입력된 문제 종류/위치는 그대로 두고, 실제로 이상했던 점만 간단히 적어주시면 됩니다.
```

문항:

| 순서 | 문항명 | 유형 | 필수 | 앱 자동 입력 |
| --- | --- | --- | --- | --- |
| 1 | 문제 종류 | 단답형 | 아니오 | 예 |
| 2 | 문제 위치/대상 | 단답형 | 아니오 | 예 |
| 3 | 어떤 점이 이상했나요? | 단락형 | 예 | 아니오 |
| 4 | 기대한 모습 또는 추가 설명 | 단락형 | 아니오 | 아니오 |
| 5 | 스크린샷 ID | 단답형 | 아니오 | 예 |
| 6 | 앱 자동 디버그 정보 | 단락형 | 아니오 | 예 |
| 7 | 연락처 | 단답형 | 아니오 | 아니오 |

스크린샷 업로드 문항은 공개 테스트에서는 기본으로 넣지 않는 것을 권장합니다. Google 공식 도움말에 따르면 파일 업로드 문항은 응답자 Google 계정 로그인이 필요하고, 업로드 파일은 폼 소유자의 Google Drive에 저장됩니다. 꼭 필요하면 “스크린샷 업로드”를 선택 문항으로 추가하세요.

## Form 설정

권장 설정:

- `응답`에서 이메일 수집 끄기
- `응답`에서 1회 응답 제한 끄기
- `프레젠테이션`에서 자동 저장은 필요에 따라 유지
- 폼을 게시한 뒤 응답자 링크 접근 권한을 확인

Google 공식 도움말 기준으로, 폼은 게시된 뒤 응답자 링크를 복사해서 공유할 수 있습니다. 문항 추가는 `Google Forms -> Add question`, 문항 유형 선택, 필수 여부 설정 순서로 진행합니다.

## 미리 채워진 링크 만들기

앱이 Google Form을 자동으로 채우려면 `entry.<number>` ID가 필요합니다.

1. Google Forms에서 폼을 엽니다.
2. 오른쪽 위 `더보기` 메뉴를 누릅니다.
3. `Pre-fill form` 또는 `미리 채워진 링크 가져오기`를 선택합니다.
4. 아래 세 문항에 임시 값을 넣습니다.
   - 문제 종류: `TYPE_PLACEHOLDER`
   - 문제 위치/대상: `TARGET_PLACEHOLDER`
   - 스크린샷 ID: `SCREENSHOT_PLACEHOLDER`
   - 앱 자동 디버그 정보: `DEBUG_PLACEHOLDER`
5. `Get link`를 누르고 링크를 복사합니다.
6. 복사한 URL에서 각 임시 값 앞의 `entry.<number>`를 찾습니다.

예:

```text
https://docs.google.com/forms/d/e/.../viewform?usp=pp_url&entry.111=TYPE_PLACEHOLDER&entry.222=TARGET_PLACEHOLDER&entry.333=SCREENSHOT_PLACEHOLDER&entry.444=DEBUG_PLACEHOLDER
```

이 경우 환경변수는 다음처럼 설정합니다.

```env
FEEDBACK_FORM_URL=https://docs.google.com/forms/d/e/.../viewform
FEEDBACK_ENTRY_TYPE=entry.111
FEEDBACK_ENTRY_TARGET=entry.222
FEEDBACK_ENTRY_SCREENSHOT_REPORT_ID=entry.333
FEEDBACK_ENTRY_DEBUG=entry.444
```

`FEEDBACK_FORM_URL`에는 `viewform` 링크 전체를 넣어도 되고, `?usp=...`가 붙어 있어도 됩니다. 앱은 여기에 자동 입력 파라미터를 추가합니다.

## 프론트엔드 연결

로컬 또는 배포 환경에 다음 값을 설정합니다.

```env
FEEDBACK_FORM_URL=
FEEDBACK_ENTRY_TYPE=
FEEDBACK_ENTRY_TARGET=
FEEDBACK_ENTRY_DEBUG=
FEEDBACK_ENTRY_SCREENSHOT_REPORT_ID=
```

이 프로젝트의 webpack 설정은 환경변수를 빌드 시점에 JS 번들로 주입합니다. 따라서 값을 바꾼 뒤에는 다시 빌드/배포해야 합니다.

폼 URL이 비어 있으면 앱은 깨진 링크를 열지 않고 “피드백 폼 링크가 아직 설정되지 않았습니다” 안내를 표시합니다.

## 자동 스크린샷 수집

Google Form은 브라우저 보안상 파일 업로드 문항을 앱에서 자동으로 채울 수 없습니다. 대신 이 프로젝트는 지도 캔버스를 JPEG로 캡처해 Google Apps Script Web App으로 보내고, Apps Script가 Google Drive와 Google Sheets에 저장하는 방식을 사용합니다.

사용자 흐름:

1. 사용자가 앱에서 피드백 종류를 고릅니다.
2. 앱이 내부 지도 캔버스를 자동 캡처합니다.
3. 앱이 캡처 이미지를 숨은 form POST로 Apps Script에 보냅니다.
4. Google Form은 기존처럼 열리고, `스크린샷 ID` 문항과 debug 정보에 같은 `report_id`가 들어갑니다.
5. 개발자는 Google Sheet에서 같은 `report_id` 행의 스크린샷 썸네일을 확인합니다.

Google Form 응답 시트 안에서 바로 이미지를 보고 싶다면 Apps Script 상단의 `FORM_RESPONSE_SPREADSHEET_ID`에 Form 응답 스프레드시트 ID를 넣고 `setup()`을 다시 실행하세요. 그러면 응답 탭에 `스크린샷`, `스크린샷 링크` 보조 열이 추가되고, `스크린샷 ID` 값으로 `feedback_screenshots` 시트의 이미지를 자동 조회합니다.

### Apps Script 만들기

1. [Google Apps Script](https://script.google.com/)에서 새 프로젝트를 만듭니다.
2. [feedback-screenshot-upload.gs](apps-script/feedback-screenshot-upload.gs)의 전체 코드를 붙여넣습니다.
3. 코드 상단의 `SPAM_GUARD_TOKEN`에 짧은 임의 문자열을 넣습니다.
   - 이 값은 프론트엔드 번들에 보이므로 강한 보안 비밀은 아닙니다.
   - 무작위 대량 POST를 조금 줄이는 용도입니다.
4. 같은 Form 응답 스프레드시트에서 이미지를 보고 싶다면 `FORM_RESPONSE_SPREADSHEET_ID`에 응답 스프레드시트 ID를 넣습니다.
   - 예: `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`에서 `SPREADSHEET_ID` 부분입니다.
   - `FORM_RESPONSE_SHEET_NAME`은 비워두면 스크립트가 `스크린샷 ID` 헤더가 있는 응답 탭을 자동으로 찾습니다.
   - 직접 지정하려면 실제 탭 이름을 정확히 넣습니다. 예: `설문지 응답 시트1`
5. Apps Script 편집기에서 `setup()` 함수를 한 번 실행하고 권한을 승인합니다.
6. 실행 로그에 나온 `Spreadsheet URL`과 `Drive folder URL`을 확인합니다.

### Web App으로 배포

1. Apps Script 오른쪽 위 `Deploy` → `New deployment`를 누릅니다.
2. 배포 유형에서 `Web app`을 선택합니다.
3. 설정:
   - Execute as: `Me`
   - Who has access: `Anyone`
4. 배포 후 `/exec`로 끝나는 Web App URL을 복사합니다.

공식 문서에 따르면 Apps Script Web App은 `doGet(e)` 또는 `doPost(e)` 함수를 포함해야 하며, `Deploy > New deployment`에서 Web App으로 배포합니다.

### 프론트엔드 환경변수

복사한 Web App URL과 토큰을 넣습니다.

```env
FEEDBACK_SCREENSHOT_UPLOAD_URL=https://script.google.com/macros/s/AKfycbwkOjTmvO_0CEHmfSD82Arr9K4rc3TLSm8OQsfcNAT7ZGYRegc02BFANKf6rR1NUyoPOg/exec
FEEDBACK_SCREENSHOT_TOKEN=skku-feedback-2026
```

이 값도 빌드 시점에 주입되므로 바꾼 뒤에는 다시 빌드/배포해야 합니다.

### 제한과 fallback

- Apps Script 응답은 CORS 때문에 프론트엔드에서 안정적으로 읽지 않습니다. 그래서 앱은 `report_id`를 먼저 만들고, 업로드 요청은 숨은 form POST로 보냅니다.
- 지도 타일 CORS나 WebGL 상태 때문에 캔버스 캡처가 실패할 수 있습니다. 이 경우 Google Form은 계속 열리고 debug 정보에 `screenshot_status: capture_failed`가 들어갑니다.
- Apps Script 공식 quota 기준으로 POST 크기 제한은 50MB이고, 1회 실행 제한은 6분입니다. 앱은 JPEG 캡처 1장만 보내므로 일반 사용자 테스트 규모에서는 충분합니다.
- Sheet의 `IMAGE()` 썸네일 렌더링을 위해 Apps Script는 Drive 파일을 “링크가 있는 모든 사용자 보기 가능”으로 설정합니다. 공개 링크가 부담되면 `file.setSharing(...)` 줄을 제거하세요. 이 경우 Sheet 썸네일은 안 보일 수 있지만 Drive 링크로는 확인할 수 있습니다.

## 확인 방법

1. `npm run build`가 통과하는지 확인합니다.
2. 앱에서 `피드백` 버튼을 누릅니다.
3. `방/지도 오류`를 선택하고 지도 위 방 또는 위치를 누릅니다.
4. Google Form이 새 탭으로 열리고 `문제 종류`, `문제 위치/대상`, `앱 자동 디버그 정보`가 미리 입력되는지 확인합니다.
5. `경로 오류`, `영상 오류`, `기타`도 각각 폼이 열리는지 확인합니다.

## 참고 자료

- [Google Forms 문항 추가/편집 공식 도움말](https://support.google.com/docs/answer/2839737?hl=en)
- [Google Forms 문항 유형 공식 도움말](https://support.google.com/docs/answer/7322334?hl=en)
- [Google Forms 게시, 공유, 미리 채워진 링크 공식 도움말](https://support.google.com/docs/answer/2839588?hl=en)
- [Google Forms 응답 오류 및 파일 업로드 공식 도움말](https://support.google.com/docs/answer/15473134?hl=en)
- [Google Apps Script Web Apps 공식 도움말](https://developers.google.com/apps-script/guides/web?hl=en)
- [Google Apps Script Quotas 공식 문서](https://developers.google.com/apps-script/guides/services/quotas)
