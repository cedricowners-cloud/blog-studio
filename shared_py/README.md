# shared_py

`content_service`와 `local_agent`가 공유하는 Python 모듈. Chrome 의존 없는 순수 로직만.

## 예정 모듈 (Step 1에서 이관)

```
shared_py/
├── content/
│   ├── keywords_analysis.py   # blog_auto/keywords_analysis.py 이관
│   ├── image_collector.py     # blog_auto/image_collector.py 이관
│   └── youtube_script.py      # blog_auto/youtube_script.py 이관
├── cards/                      # blog_auto/card_news/ 이관
│   ├── parser.py
│   ├── generator.py
│   ├── renderer.py
│   └── templates/
└── db/
    └── supabase_client.py      # 공통 Supabase Python 클라이언트
```

## 참고

- 기존 `blog_auto/` 원본은 **수정하지 않음**. 복사 기반 이관
- `create_contents_sec.py`는 이관 대상 **아님** — Ontology v2는 `content_service/ontology/`에서 새로 구현
