# Git Cheatsheet — tongkk 워크플로우

> 작업 전 항상 먼저 확인:
> ```bash
> pwd        # 올바른 디렉토리인지 (tongkk vs tongkk-langgraph 혼동 주의)
> git status # 현재 브랜치 및 변경사항 확인
> ```

---

## 1. PR 머지 충돌 해결

```bash
# 1. 충돌난 PR 브랜치로 이동
git checkout feature/my-branch

# 2. main 최신 상태로 당겨오기
git fetch origin
git merge origin/main

# 3. 충돌 파일 확인
git status
# "both modified: src/pages/Summary.tsx" 같은 항목 찾기

# 4. 파일 열어서 직접 수정
# <<<<<<< HEAD (내 변경)
# =======
# >>>>>>> origin/main (main 변경)
# 위 마커 없애고 원하는 내용으로 수정

# 5. 수정 완료 후 스테이징 및 커밋
git add src/pages/Summary.tsx
git commit -m "chore: resolve merge conflict with main"

# 6. PR 브랜치 push
git push origin feature/my-branch
```

**충돌 파일이 많을 때:**
```bash
git diff --name-only --diff-filter=U  # 충돌난 파일 목록만 보기
```

---

## 2. Rebase vs Merge — 언제 뭘 써야 하나

| 상황 | 방법 | 이유 |
|------|------|------|
| PR 올리기 전 main 반영 | **rebase** | 커밋 히스토리 깔끔하게 유지 |
| 이미 push된 브랜치에 main 반영 | **merge** | rebase 후 force push 위험 있음 |
| main에 feature 합치는 PR | **merge** (GitHub에서) | 협업 흐름 추적 가능 |
| 로컬에서만 작업 중인 브랜치 | **rebase** 가능 | push 전이라 안전 |

**Rebase (push 전에만):**
```bash
git fetch origin
git rebase origin/main
# 충돌 나면: 수정 → git add → git rebase --continue
# 취소하려면: git rebase --abort
```

**Merge (이미 push된 브랜치):**
```bash
git fetch origin
git merge origin/main
```

> ⚠️ 이미 push한 브랜치에 rebase 하면 force push 필요 → 팀 작업 시 위험. **push된 브랜치는 merge 사용.**

---

## 3. Feature 브랜치에 main 안전하게 당겨오기

**가장 안전한 방법 (push 된 브랜치):**
```bash
git checkout feature/my-branch
git fetch origin
git merge origin/main
# 충돌 해결 후
git push origin feature/my-branch
```

**로컬에서만 작업 중일 때 (깔끔한 히스토리 원할 때):**
```bash
git checkout feature/my-branch
git fetch origin
git rebase origin/main
# 충돌 해결 후 git rebase --continue
# push는 아직 안 했으니 git push origin feature/my-branch
```

**현재 작업 중인데 main만 빠르게 확인하고 싶을 때:**
```bash
git stash          # 현재 변경사항 임시 저장
git checkout main
git pull origin main
git checkout feature/my-branch
git stash pop      # 변경사항 복원
```

---

## 4. Push된 커밋 되돌리기 (Force Push 없이)

> **핵심 원칙**: `git reset --hard` + force push 대신 → `git revert` 사용

**커밋 1개 되돌리기:**
```bash
# 되돌릴 커밋 해시 확인
git log --oneline -10

# revert 커밋 생성 (기존 커밋은 유지, 반대 커밋 추가)
git revert abc1234
# 에디터 열리면 저장 후 종료 (:wq)

# push
git push origin main
```

**여러 커밋 되돌리기:**
```bash
# 가장 최근 3개 커밋 되돌리기
git revert HEAD~2..HEAD
# 또는 하나씩
git revert abc1234
git revert def5678
git push origin main
```

**revert를 또 되돌려야 할 때 (revert of revert):**
```bash
# revert 커밋 해시 확인
git log --oneline -10

# 그 revert 커밋을 다시 revert
git revert xyz9999
git push origin main
```

**실수로 main에 push한 커밋 빠르게 없애기:**
```bash
git revert HEAD      # 가장 최근 커밋 되돌리기
git push origin main
```

> ✅ `git revert`는 히스토리를 지우지 않고 "반대 커밋"을 추가하므로 협업 시 안전.
> ❌ `git reset --hard` + `git push --force`는 팀원 작업이 사라질 수 있으니 사용 금지.

---

## 자주 쓰는 확인 명령어

```bash
git log --oneline -10          # 최근 커밋 10개 보기
git log --oneline origin/main..HEAD  # main 대비 내 커밋만 보기
git diff origin/main           # main과 현재 차이 보기
git branch -a                  # 로컬 + 원격 브랜치 전체 보기
git remote -v                  # 현재 remote 주소 확인 (repo 혼동 방지)
```
