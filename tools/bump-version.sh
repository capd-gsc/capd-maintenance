#!/bin/sh
# เปลี่ยนเลขเวอร์ชันใน index.html (ทุก ?v= และ APP_VERSION) ให้ผู้ใช้ได้ไฟล์ใหม่ทันทีหลังอัปเดต
# ใช้: sh tools/bump-version.sh            → ใช้วันเวลาปัจจุบัน
#      sh tools/bump-version.sh 2026.12.01 → กำหนดเอง
set -e
V=${1:-$(date +%Y.%m.%d.%H%M)}
cd "$(dirname "$0")/.."
sed -i -E "s/(\?v=)[0-9A-Za-z.]+/\1$V/g; s/(APP_VERSION = ')[^']+/\1$V/" index.html
echo "version → $V"
