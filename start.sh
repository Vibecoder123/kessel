#!/bin/bash
apt-get install -y poppler-utils tesseract-ocr 2>/dev/null || true
node src/index.js
