@echo off
rem 에이전트 실행 래퍼 (Windows) — local_agent/agent 의 대응물.
rem
rem   agent.bat pair       페어링
rem   agent.bat            실행 (트레이 아이콘)
rem   agent.bat --no-tray  콘솔 로그만
rem   agent.bat migrate    passphrase 파일 -> Windows 자격 증명 관리자
rem
rem 자기 위치(%~dp0)를 기준으로 venv 와 run.py 를 찾으므로 어느 폴더에서
rem 실행해도 동일하게 동작한다. venv 가 없으면 만들고 의존성까지 설치한다.
rem
rem 주의: 상주 등록(install)은 Windows 에서 제공하지 않는다. launchd 에
rem 대응하는 자동 등록은 테스트하지 못했으므로, 시작프로그램 폴더에
rem 바로가기를 두는 방식을 문서로 안내한다(웹 /agent 가이드 참조).
setlocal

set "DIR=%~dp0"
set "PY=%DIR%.venv\Scripts\python.exe"

if not exist "%PY%" (
    echo venv 가 없습니다 - %DIR%.venv 에 생성합니다.
    python -m venv "%DIR%.venv"
    if errorlevel 1 (
        echo.
        echo python 을 찾을 수 없습니다. python.org 에서 Python 3.11 이상을
        echo 설치하고, 설치 화면에서 "Add python.exe to PATH" 를 체크하세요.
        exit /b 1
    )
    "%DIR%.venv\Scripts\python.exe" -m pip install --quiet --upgrade pip
    "%DIR%.venv\Scripts\python.exe" -m pip install --quiet -r "%DIR%requirements.txt"
    echo 설치 완료.
)

"%PY%" "%DIR%run.py" %*
exit /b %errorlevel%
