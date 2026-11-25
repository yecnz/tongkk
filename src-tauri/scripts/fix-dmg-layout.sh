#!/bin/sh
# Tauri가 만든 DMG는 Finder 정렬(이름순)·아이콘 크기(48)·배경 이미지가 저장되지 않아 배치가 무시된다.
# 빌드 후 실행: sh src-tauri/scripts/fix-dmg-layout.sh  →  src-tauri/target/Tongkk.dmg 생성
set -e
cd "$(dirname "$0")/.."
SRC=target/universal-apple-darwin/release/bundle/dmg/Tongkk_0.1.0_universal.dmg
TMP=$(mktemp -d)
hdiutil convert "$SRC" -format UDRW -o "$TMP/rw.dmg" -quiet
hdiutil attach "$TMP/rw.dmg" -noautoopen -quiet
MNT=/Volumes/Tongkk
osascript <<'EOF'
tell application "Finder"
  tell disk "Tongkk"
    open
    set w to container window
    set o to icon view options of w
    set arrangement of o to not arranged
    set icon size of o to 128
    set text size of o to 13
    set background picture of o to file ".background:background.tiff"
    set position of item "Tongkk.app" of w to {170, 170}
    set position of item "Applications" of w to {430, 170}
    close
    open
    update without registering applications
    delay 2
    close
  end tell
end tell
EOF
# Finder가 지우는 볼륨 아이콘을 되살림
[ -f "$MNT/.VolumeIcon.icns" ] || cp icons/icon.icns "$MNT/.VolumeIcon.icns"
SetFile -a C "$MNT"
rm -rf "$MNT/.fseventsd"
sync
hdiutil detach "$MNT" -quiet
rm -f target/Tongkk.dmg
hdiutil convert "$TMP/rw.dmg" -format UDZO -imagekey zlib-level=9 -o target/Tongkk.dmg -quiet
rm -rf "$TMP"
echo "src-tauri/target/Tongkk.dmg"
