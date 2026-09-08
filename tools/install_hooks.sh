#!/usr/bin/env bash
# 훅 재설치 , .git/hooks 는 클론에 안 따라온다. 새 환경에서 한 번 돌린다.
cd "$(dirname "$0")/.." && mkdir -p .git/hooks && cp tools/hooks/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit && echo "✅ pre-commit 설치"
