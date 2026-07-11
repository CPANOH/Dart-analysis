# 재무 분석기2 (Dart-analysis)

DART(전자공시시스템) Open API로 여러 상장기업의 재무제표를 비교하고 엑셀로
내려받는 웹앱입니다. 업종으로 먼저 후보를 좁히고(시가총액 상위 20개),
회사명으로 다시 좁혀 최대 5개 회사를 선택해 최대 10개년 재무제표를 비교합니다.

개발 배경과 아키텍처는 [PRD.md](./PRD.md) 참고.

배포: https://jaemu-analyzer-web.vercel.app

## 로컬 실행

```bash
npm install
npm run dev
```

`.env.local`에 `DART_API_KEY`가 필요합니다 ([opendart.fss.or.kr](https://opendart.fss.or.kr)에서 무료 발급).

```
DART_API_KEY=발급받은_키
```

## 기능

- 1차 필터(업종) → 2차 필터(회사명)로 후보 압축 후 최대 5개 선택
- 업종 매칭 시 네이버 증권 데이터 기준 시가총액 상위 20개를 후보로 제시
- 업종 미매칭 시 KRX 상장법인목록 기반 회사명 검색으로 폴백
- 최대 10개년 조회, 요약비교/회사별 상세 시트가 담긴 엑셀 자동 생성

## 배포 (Vercel)

이 저장소는 Vercel 프로젝트 `jaemu-analyzer-web`에 연결되어 있습니다.
`main` 브랜치에 push하면 자동으로 프로덕션에 배포됩니다.
`DART_API_KEY` 환경변수는 Vercel 프로젝트 설정에서 관리합니다(저장소에는 포함되지 않음).
