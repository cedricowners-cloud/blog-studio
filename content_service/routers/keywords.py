"""키워드 분석 라우터 — 네이버 검색광고 API + 블로그 수 병합."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from shared_py.content import keywords_analysis as ka

logger = logging.getLogger(__name__)

router = APIRouter()


class KeywordMetric(BaseModel):
    """UI 표 한 행에 매핑되는 지표 세트."""
    keyword: str
    monthly_pc_qc: int          # 월간검색수 PC
    monthly_mobile_qc: int      # 월간검색수 Mobile
    total_qc: int               # 합계
    blog_monthly_count: int | None = None   # 월간 블로그 발행 수량
    blog_saturation: float | None = None    # 포화도 (%) = 블로그수 / 검색수 * 100
    shopping_category: str | None = None
    monthly_ave_pc_clk: float | None = None     # 월평균 클릭수 PC
    monthly_ave_mobile_clk: float | None = None # 월평균 클릭수 Mobile
    monthly_ave_pc_ctr: float | None = None     # 월평균 클릭율 PC
    monthly_ave_mobile_ctr: float | None = None # 월평균 클릭율 Mobile
    comp_idx: str | None = None                 # 경쟁정도 (낮음/중간/높음)
    pl_avg_depth: float | None = None           # 월평균 노출광고수


class KeywordLookupResponse(BaseModel):
    query: str
    results: list[KeywordMetric]
    source: str  # "live" | "cache" (Step 2+ 에서 캐시 붙일 때 사용)


def _as_int(v: Any) -> int:
    """네이버 API는 검색수가 '< 10' 같은 문자열로 올 수 있음."""
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return int(v)
    if isinstance(v, str):
        s = v.strip().lstrip("<").strip()
        if s.replace(",", "").isdigit():
            return int(s.replace(",", ""))
    return 0


def _as_float(v: Any) -> float | None:
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


@router.get("", response_model=KeywordLookupResponse)
async def lookup_keyword(
    q: str = Query(..., min_length=1, description="조회할 키워드"),
    include_blog_count: bool = Query(True, description="블로그 발행 수 조회 여부"),
):
    """조회어 + 연관 키워드의 전체 지표를 돌려줌. UI 표에 직접 매핑 가능한 스키마."""
    raw = ka.search_keyword_volume(q)
    if not raw or "keywordList" not in raw:
        logger.warning("search_keyword_volume 응답이 비어있음: %s", q)
        raise HTTPException(
            status_code=502,
            detail="네이버 검색광고 API 응답이 비어있습니다. API 키를 확인해주세요.",
        )

    results: list[KeywordMetric] = []
    for item in raw.get("keywordList", []):
        kw = item.get("relKeyword", "").strip()
        if not kw:
            continue

        pc = _as_int(item.get("monthlyPcQcCnt"))
        mob = _as_int(item.get("monthlyMobileQcCnt"))
        total = pc + mob

        blog_count: int | None = None
        saturation: float | None = None
        if include_blog_count:
            # 블로그 검색 API의 total 값을 월간 추정치로 그대로 사용. 네이버 공식 API가
            # '월간' 필터를 직접 지원하지 않아, 향후 date 범위 파라미터 도입 시 정확도 개선.
            blog_hits = ka.search_blog_api(kw, display=1)
            # search_blog_api는 items 배열만 돌려주는 구조라서 총 개수가 없음.
            # 일단 None으로 두고 Step 5에서 total 직접 추출하도록 확장. 여기선 스캐폴딩.
            blog_count = None if blog_hits is None else (len(blog_hits) if isinstance(blog_hits, list) else None)
            if blog_count is not None and total > 0:
                saturation = round(blog_count / total * 100, 2)

        results.append(KeywordMetric(
            keyword=kw,
            monthly_pc_qc=pc,
            monthly_mobile_qc=mob,
            total_qc=total,
            blog_monthly_count=blog_count,
            blog_saturation=saturation,
            shopping_category=None,  # Step 5에서 네이버 쇼핑 API 연동
            monthly_ave_pc_clk=_as_float(item.get("monthlyAvePcClkCnt")),
            monthly_ave_mobile_clk=_as_float(item.get("monthlyAveMobileClkCnt")),
            monthly_ave_pc_ctr=_as_float(item.get("monthlyAvePcCtr")),
            monthly_ave_mobile_ctr=_as_float(item.get("monthlyAveMobileCtr")),
            comp_idx=item.get("compIdx"),
            pl_avg_depth=_as_float(item.get("plAvgDepth")),
        ))

    results.sort(key=lambda r: r.total_qc, reverse=True)
    return KeywordLookupResponse(query=q, results=results, source="live")
