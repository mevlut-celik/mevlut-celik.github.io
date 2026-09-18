#!/bin/sh
# CFP PDF'lerini _tools/cfp-*.html kaynaklarından üretir (macOS, Google Chrome gerekir).
cd "$(dirname "$0")/.." || exit 1
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for L in tr en; do
  U=$(echo "$L" | tr a-z A-Z)
  "$CHROME" --headless --disable-gpu --no-pdf-header-footer --virtual-time-budget=6000 \
    --print-to-pdf="$PWD/assets/SIU_2027_CFP_$U.pdf" "file://$PWD/_tools/cfp-$L.html" 2>/dev/null
  echo "assets/SIU_2027_CFP_$U.pdf"
done
