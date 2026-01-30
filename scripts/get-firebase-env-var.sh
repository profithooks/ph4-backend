#!/bin/bash
# Convert Firebase service account JSON to single-line string for Render

FILE_PATH=".secrets/ph4-firebase-admin.json"

if [ ! -f "$FILE_PATH" ]; then
  echo "❌ Firebase service account file not found at: $FILE_PATH"
  exit 1
fi

echo "✅ Firebase service account found!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Copy the following value and add it to Render:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "FIREBASE_SERVICE_ACCOUNT_JSON="
cat "$FILE_PATH" | tr -d '\n' | tr -d ' '
echo ""
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Steps to add to Render:"
echo "1. Go to: https://dashboard.render.com/web/YOUR-SERVICE-ID/env"
echo "2. Click 'Add Environment Variable'"
echo "3. Key: FIREBASE_SERVICE_ACCOUNT_JSON"
echo "4. Value: (paste the entire line above)"
echo "5. Click 'Save Changes'"
echo ""
echo "⚠️  IMPORTANT: This will trigger a new deployment!"
