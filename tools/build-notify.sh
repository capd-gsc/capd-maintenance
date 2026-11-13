#!/bin/sh
# รวม supabase/functions/notify/core.ts + index.ts เป็นไฟล์เดียว สำหรับวางในหน้า Edge Functions ของ Supabase (Via Editor)
set -e
cd "$(dirname "$0")/../supabase/functions/notify"
{ echo "// ไฟล์นี้สร้างจาก tools/build-notify.sh — อย่าแก้ตรงนี้ ให้แก้ core.ts / index.ts แล้วรันสคริปต์ใหม่"
  grep -v '^import .* from "./core.ts";' index.ts | sed -n '1,/^import { createClient }/p'
  cat core.ts
  grep -v '^import .* from "./core.ts";' index.ts | sed '1,/^import { createClient }/d'
} > single-file.ts
echo "built supabase/functions/notify/single-file.ts"
