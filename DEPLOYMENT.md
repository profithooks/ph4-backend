# PH4 Backend Deployment Guide

## Environment Variables

### Required in Production

The following environment variables **must** be set in production:

- `JWT_SECRET` - Must be 32+ characters (generate with `openssl rand -base64 32`)
- `MONGO_URI` - MongoDB connection string
- `PUBLIC_APP_BASE_URL` - Web frontend base URL for shareable bill links (e.g., `https://www.profithooks.com`)

### Optional but Recommended

- `TRUST_PROXY=true` - Enable if behind reverse proxy (nginx, CloudFlare, AWS ALB) to correctly detect protocol/host
- `NODE_ENV=production` - Set to production mode
- `SENTRY_DSN` - Error tracking (recommended for production)

## Share Bill Links

### Overview

The share bill link feature allows businesses to generate public, shareable links for bills that can be viewed without authentication.

**Architecture:**
- **Backend**: Creates/revokes tokens and serves JSON data at `GET /public/b/:token.json`
- **Web Frontend**: Renders bill viewer page at `GET /b/:token` (fetches JSON from backend)
- **Share Links**: Point to web frontend domain: `{PUBLIC_APP_BASE_URL}/b/:token`

### Configuration

**PUBLIC_APP_BASE_URL** (Required in production)

- **Purpose**: Web frontend base URL for shareable bill links
- **Format**: Full domain with protocol (e.g., `https://www.profithooks.com`)
- **Production**: **MUST** be set to your production web domain
- **Development**: Defaults to `http://localhost:5173` (Vite dev server port)

**Example:**
```bash
# Development (default)
PUBLIC_APP_BASE_URL=http://localhost:5173

# Production
PUBLIC_APP_BASE_URL=https://www.profithooks.com
```

### How It Works

1. **Backend** generates share link with token and returns URL: `{PUBLIC_APP_BASE_URL}/b/:token`
2. **Web frontend** receives request at `/b/:token` route
3. **Web frontend** fetches bill data from backend: `GET {API_BASE_URL}/public/b/:token.json`
4. **Web frontend** renders bill viewer page with fetched data

#### Nginx Example

```nginx
# Route API requests to backend
location /api/ {
    proxy_pass http://localhost:5055;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# Route public bill JSON endpoint to backend
location /public/ {
    proxy_pass http://localhost:5055;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# All other routes (including /b/:token) go to frontend (ph4-web)
location / {
    try_files $uri $uri/ /index.html;
    root /path/to/ph4-web/dist;
}
```

**Note:** The `/b/:token` route is handled by the web frontend (React Router). The frontend then fetches JSON from `/public/b/:token.json` which is proxied to the backend.

#### Important Notes

1. **TRUST_PROXY**: If using a reverse proxy, set `TRUST_PROXY=true` in your `.env` file. This ensures `req.protocol` and `req.get('host')` are correctly detected from `X-Forwarded-*` headers.

2. **HTTPS**: Ensure your reverse proxy terminates SSL/TLS and forwards requests to the backend over HTTP (or internal HTTPS).

3. **CORS**: Update `CORS_ORIGINS` to include your production frontend domain if needed.

### Testing Share Links

1. **Create a share link** (requires Pro plan):
   ```bash
   POST /api/bills/:id/share-link
   Authorization: Bearer <token>
   ```

2. **Response**:
   ```json
   {
     "success": true,
     "data": {
       "url": "https://www.profithooks.com/b/<token>",
       "token": "<48-char-hex-token>"
     }
   }
   ```

3. **View public bill**:
   - Open the URL in a browser: `https://www.profithooks.com/b/<token>`
   - Web frontend fetches JSON from backend: `GET /public/b/:token.json`
   - Web frontend renders bill viewer page

4. **Fetch JSON directly** (for API consumers):
   ```bash
   GET /public/b/:token.json
   ```

5. **Revoke link**:
   ```bash
   DELETE /api/bills/:id/share-link
   Authorization: Bearer <token>
   ```

### Error Handling

If `PUBLIC_APP_BASE_URL` is not set in production, share link creation will fail with:

```json
{
  "success": false,
  "message": "PUBLIC_APP_BASE_URL must be set in production environment",
  "code": "MISSING_PUBLIC_APP_BASE_URL"
}
```

This ensures share links always use the correct production web domain and never fallback to localhost in production.

## Security Considerations

1. **Rate Limiting**: Public bill endpoints are rate-limited (60 requests/minute per IP) to prevent abuse.

2. **Token Security**: Share link tokens are 48-character random hex strings (unguessable).

3. **Revocation**: Business owners can revoke share links at any time.

4. **Sanitization**: Public bill responses are sanitized to remove sensitive internal data (user IDs, internal notes, etc.).

5. **HTTPS Only**: In production, ensure all share links use HTTPS.

## Troubleshooting

### Share links show localhost in production

**Cause**: `PUBLIC_APP_BASE_URL` is not set or incorrect.

**Fix**: Set `PUBLIC_APP_BASE_URL=https://www.profithooks.com` in your production `.env` file and restart the server.

### Share links show HTTP instead of HTTPS

**Cause**: `TRUST_PROXY` is not enabled, or reverse proxy is not forwarding `X-Forwarded-Proto` header.

**Fix**: 
1. Set `TRUST_PROXY=true` in `.env`
2. Ensure reverse proxy forwards `X-Forwarded-Proto: https` header

### Public bill page returns 404

**Cause**: Web frontend route `/b/:token` not configured, or backend JSON endpoint `/public/b/:token.json` not accessible.

**Fix**: 
1. Ensure web frontend has route `/b/:token` configured (React Router)
2. Ensure reverse proxy routes `/public/*` to backend for JSON endpoint (see Nginx example above)
3. Ensure web frontend can reach backend API (check `VITE_API_BASE_URL` in web app)
