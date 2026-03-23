# 🔗 URL-SHORTENER (Safe & Scalable)
A high-performance URL shortener built with **TypeScript**, **Express**, and **Supabase**. Featuring advanced security layers, JWT rotation, and anti-bot measures.

## 🛠️ Setup & Installation

### 1. Database Configuration
Create a project in Supabase and execute the following SQL in the Query Editor (Copie o código abaixo):
```SQL
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(30) UNIQUE NOT NULL,
    email VARCHAR(50) UNIQUE NOT NULL,
    password TEXT NOT NULL,
    token_version INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE urls (
    id SERIAL PRIMARY KEY,
    url TEXT NOT NULL,
    owner_username VARCHAR(30) NOT NULL,
    clicks INT NOT NULL DEFAULT 0,
    favorited BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT fk_owner FOREIGN KEY(owner_username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE TABLE blacklist (
    id SERIAL PRIMARY KEY,
    ip VARCHAR(45) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_urls_owner ON urls(owner_username);
CREATE INDEX idx_urls_favorited_owner ON urls(owner_username, favorited);
CREATE INDEX idx_blacklist_ip ON blacklist(ip);
```

### 2. Environment Variables (.env)
```env
Create a .env file in the root directory:
DB_URL=https://your-project.supabase.co
DB_SECRET=your-service-role-key
HASHIDS_SALT=a-very-secret-salt-for-encoding
```

### 3. Project Settings (settings.json)
Configure your server and security keys:
```json
{
    "port": 3000,
    "jwt_secret": "access-token-secret-key",
    "jwt_refresh_secret": "refresh-token-secret-key",
    "honeypot_logger": "active"
}
```

## 🚀 Features & Limits
- Rate Limiting: 40 requests/min global, 5 creations/day.
- Honeypot Security: Automated blacklisting for fake "admin" roles.
- JWT Architecture: Dual-token system with versioning.
- Obfuscation: Hashids for URL safety.

## 📡 API Endpoints
- GET /URLs/:id -> Redirect + Tracking.
- POST /v1/users/sign-up -> Safe Registration.
- POST /v1/users/login -> Token Issuance.
- POST /v1/shortner/short-url -> Generate link.
- PATCH /v1/shortner/favorite -> Toggle favorite.

---
- Developed by Venom ❤️