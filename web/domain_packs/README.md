# Domain Packs (legacy markdown archive)

> **현재 시스템은 DB(`domains` 테이블 + JSONB 컬럼)에서 도메인 데이터를 읽습니다.**
> 이 디렉토리의 마크다운 파일은 Phase 2A 마이그레이션 008 이전의 **레퍼런스 / 시드 출처**입니다.
> 실제 편집은 **`/domains/[code]/edit`** UI 에서 수행하세요.

## 위치

- `_archive/_template/` — 신규 도메인 작성용 빈 템플릿 (참고)
- `_archive/public_procurement/` — 첫 도메인 패키지의 마크다운 초안 (DB 시드 출처)

## 새 도메인 추가 방법

UI 사용 (권장):
1. `/domains` 페이지 → "+ 새 도메인 생성"
2. 코드(`tax_consulting` 등) + 표시명 입력
3. 4개 탭 (포지셔닝 / 독자 페르소나 / 어휘집 / 도메인 클래스) 채우기
4. 저장

DB 직접:
```sql
INSERT INTO domains (domain_code, domain_name, positioning_benefit, package_path, positioning_data, ...)
VALUES (...);
```

## 마크다운 파일 폐기 시점

- v2 시스템 안정화 후 (Phase 5 완료)
- 또는 사용자가 명시적으로 "삭제 OK" 표시 시
