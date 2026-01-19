#!/bin/bash

echo "═══════════════════════════════════════════════════════════════════"
echo "  MSG91 OTP Setup & Test Script"
echo "═══════════════════════════════════════════════════════════════════"
echo ""

# Install axios
echo "📦 Installing axios..."
npm install axios

if [ $? -ne 0 ]; then
    echo "❌ Failed to install axios"
    echo "Run: sudo chown -R \$(whoami) ~/.npm"
    echo "Then run this script again"
    exit 1
fi

echo "✅ axios installed"
echo ""

# Update .env file
echo "🔧 Configuring .env file..."

# Check if OTP config already exists
if grep -q "MSG91_AUTHKEY" .env 2>/dev/null; then
    echo "⚠️  MSG91 config already exists in .env"
    echo "Updating authkey..."
    sed -i.bak 's/MSG91_AUTHKEY=.*/MSG91_AUTHKEY=470072AvTqEFfxU696cee15P1/' .env
else
    echo "Adding MSG91 config to .env..."
    cat >> .env << 'EOF'

# OTP Configuration (Added by setup script)
OTP_PROVIDER=MSG91
MSG91_AUTHKEY=470072AvTqEFfxU696cee15P1
MSG91_SENDER_ID=
MSG91_TEMPLATE_ID=

# OTP Rate Limiting
OTP_REQUEST_LIMIT=5
OTP_REQUEST_WINDOW_MIN=15
OTP_VERIFY_LIMIT=5
OTP_VERIFY_WINDOW_MIN=15
EOF
fi

echo "✅ .env configured"
echo ""

# Show current config
echo "📋 Current OTP Configuration:"
echo "─────────────────────────────────────────────────────────────────"
grep -E "(OTP_|MSG91_)" .env | sed 's/MSG91_AUTHKEY=.*/MSG91_AUTHKEY=470072A...696cee15P1 (masked)/'
echo "─────────────────────────────────────────────────────────────────"
echo ""

# Start server in background
echo "🚀 Starting backend server..."
PORT=5055 npm run dev > otp-test.log 2>&1 &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"

# Wait for server to start
echo "⏳ Waiting for server to start..."
sleep 5

# Check if server is running
if ! lsof -i :5055 > /dev/null 2>&1; then
    echo "❌ Server failed to start"
    echo "Check otp-test.log for errors"
    cat otp-test.log
    exit 1
fi

echo "✅ Server started on port 5055"
echo ""

# Test OTP request
echo "🧪 Testing OTP Request..."
echo "─────────────────────────────────────────────────────────────────"
echo "Endpoint: POST http://localhost:5055/api/auth/otp/request"
echo "Phone: +91 9890980947"
echo "─────────────────────────────────────────────────────────────────"
echo ""

RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST http://localhost:5055/api/auth/otp/request \
  -H "Content-Type: application/json" \
  -d '{"countryCode": "+91", "phone": "9890980947"}')

HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS/d')

echo "Response Status: $HTTP_STATUS"
echo "Response Body:"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

if [ "$HTTP_STATUS" = "200" ]; then
    echo "✅ SUCCESS! OTP sent to +91 9890980947"
    echo ""
    echo "📱 Check your phone for the OTP"
    echo ""
    echo "To verify the OTP, run:"
    echo "curl -X POST http://localhost:5055/api/auth/otp/verify \\"
    echo "  -H \"Content-Type: application/json\" \\"
    echo "  -d '{\"countryCode\": \"+91\", \"phone\": \"9890980947\", \"otp\": \"YOUR_OTP\"}'"
else
    echo "❌ FAILED to send OTP"
    echo ""
    echo "Check backend logs:"
    tail -50 otp-test.log
fi

echo ""
echo "─────────────────────────────────────────────────────────────────"
echo "Server is running in background (PID: $SERVER_PID)"
echo "Logs: tail -f otp-test.log"
echo "Stop server: kill $SERVER_PID"
echo "─────────────────────────────────────────────────────────────────"
