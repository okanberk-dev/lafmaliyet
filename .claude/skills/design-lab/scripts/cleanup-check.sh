#!/bin/bash
# Design Lab: oturum sonunda geride kalan geçici dosyaları haber verir (silmez).
# Kaynak: 0xdesign/design-plugin scripts/cleanup-check.sh, bu deponun yollarına uyarlandı.

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

if [ -d ".claude-design" ]; then
    echo "[Design Lab] Uyarı: .claude-design/ altında geçici tasarım dosyaları var."
    echo "[Design Lab] /design-lab-cleanup ile kaldırın ya da elle silin."
fi

if [ -d "src/app/design-lab" ] || [ -d "src/app/design-preview" ]; then
    echo "[Design Lab] Uyarı: geçici rota klasörleri duruyor (src/app/design-lab, src/app/design-preview); yayına çıkmadan silin."
fi

feedback_files=$(find . -maxdepth 2 -name "feedback-*.json" -type f 2>/dev/null)
if [ -n "$feedback_files" ]; then
    echo "[Design Lab] Not: geri bildirim yedekleri bulundu:"
    echo "$feedback_files" | while read -r file; do
        echo "  - $file"
    done
fi

exit 0
