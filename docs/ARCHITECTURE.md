# Project Architecture

## 1. Overview

This service connects WhatsApp sessions with Salesforce webhooks. It exposes REST APIs to:

- initialize a WhatsApp session
- check session status
- fetch QR code
- send WhatsApp messages
- manage session lifecycle and reconnection

The runtime currently starts from `src/server.js` and builds the Express app in `src/app.js`.

---

## 2. Current High-Level Flow

### Request flow

1. Client sends request to `/api/...`
2. Express routes forward to a controller
3. Controller validates input and calls service layer
4. Service layer interacts with WhatsApp client/session registry
5. Webhook events are sent to Salesforce
6. Errors are handled by middleware

### Key responsibilities

- `src/controllers/*` → request validation and response formatting
- `src/routes/*` → endpoint registration
- `src/services/whatsapp/*` → WhatsApp connection, session state, recovery
- `src/services/salesforce/*` → webhook delivery and retry
- `src/middleware/*` → auth, rate limit, validation, error handling
- `src/config/*` → environment and logging
- `src/utils/*` → shared helpers

---

## 3. Recommended Clean Structure

Use the following structure to make the project easier to scale and maintain:

```text
src/
  app.js
  server.js
  bootstrap/
    server.js
  config/
    env.js
    logger.js
  controllers/
    message.controller.js
    session.controller.js
  routes/
    index.js
    health.routes.js
    session.routes.js
    message.routes.js
  services/
    whatsapp/
      clientFactory.js
      sessionRegistry.js
      qrManager.js
      reconnectManager.js
      sessionMonitor.js
      messageHandler.js
    salesforce/
      webhook.service.js
      retryQueue.js
  repositories/
    session.repository.js
  middleware/
    apiKey.middleware.js
    rateLimit.middleware.js
    validation.middleware.js
    error.middleware.js
  utils/
    response.js
    validator.js
    helpers.js
  domain/
    whatsapp/
      session.model.js
    salesforce/
      webhook.events.js
```

---

## 4. What Each Layer Should Do

### App / Bootstrap

- `src/server.js` should only start the server
- `src/app.js` should configure Express middleware and route registration
- `src/bootstrap/*` can hold startup logic such as restoring sessions

### Controllers

- Keep controllers thin
- Validate request payloads
- Call service methods
- Return standardized responses

### Services

- Own business logic
- Talk to WhatsApp clients and Salesforce
- Do not contain Express request/response objects

### Repositories

- Handle storage access
- Keep session persistence logic separate from business logic

### Middleware

- Authentication
- Rate limiting
- Validation
- Global error handler

### Utils

- Shared helper functions
- Response wrappers
- Validation or formatting helpers

---

## 5. Suggested Responsibility Split

### WhatsApp module

- `clientFactory.js` → create and initialize WhatsApp client
- `sessionRegistry.js` → in-memory session state management
- `qrManager.js` → QR generation / QR refresh logic
- `reconnectManager.js` → reconnect strategy
- `sessionMonitor.js` → cleanup and timeout checks
- `messageHandler.js` → inbound message processing

### Salesforce module

- `webhook.service.js` → send events to Salesforce
- `retryQueue.js` → retry logic for failed webhook deliveries

### API layer

- `message.controller.js` → send message requests
- `session.controller.js` → initialize / status / QR / logout

---

## 6. Suggested Runtime Flow

```text
HTTP Request
  -> route
  -> controller
  -> service
  -> WhatsApp client / Salesforce webhook
  -> response
```

For incoming messages and connection events:

```text
WhatsApp event
  -> service handler
  -> Salesforce webhook
  -> session updates
```

---

## 7. Clean Naming and Design Rules

1. Keep controllers thin and request-focused
2. Keep services business-focused
3. Avoid mixing transport logic with domain logic
4. Use one responsibility per file
5. Centralize response format in `utils/response.js`
6. Keep environment access inside `config/env.js`
7. Keep startup / restore logic outside the main server file

---

## 8. Quick Improvement Plan

1. Add a `routes/index.js` file to centralize route registration
2. Move startup/session restore logic into `bootstrap/server.js`
3. Add a `repositories/` folder for persistent state access
4. Introduce `domain/` models for session and webhook data
5. Add unit tests for services and controllers
6. Add a `README.md` with setup, API examples, and deployment notes

---

## 9. Result

With this structure, the project becomes easier to:

- understand
- extend with new features
- test independently
- debug WhatsApp and Salesforce integration issues
- onboard new developers faster
