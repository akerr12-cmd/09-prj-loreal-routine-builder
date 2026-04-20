# Project 9: L'Oréal Routine Builder

This project is a product-aware beauty chatbot experience built with plain HTML, CSS, JavaScript, and a Cloudflare Worker.

Users can:

- Browse L'Oréal products by category and search.
- Select products and build a personalized routine.
- Ask follow-up questions in chat.
- Save and download routine and atelier summaries.

## Project Files Walkthrough

### index.html

- Defines the full page structure.
- Includes sections for:
  - Header and menu actions
  - Product filters and carousel
  - Product Atelier
  - Chat interface
  - Personalized routine output
- Loads `secrets.js` and then `script.js`.

### style.css

- Controls all visual styling and responsive layout.
- Includes typography, spacing, product-card interactions, routine styles, and RTL support.
- Provides luxury visual effects (gradients, texture overlays, accents, and hover states).

### script.js

- Main frontend logic for the app.
- Handles:
  - Product loading and filtering
  - Product selection and localStorage persistence
  - Product Atelier rendering and updates
  - Chat UI rendering
  - API calls to Cloudflare Worker
  - Routine generation and suggested product add-to-routine flows
- Uses `async/await` for all API/network operations.

### RESOURCE_cloudflare-worker.js

- Secure API layer between frontend and OpenAI.
- Handles:
  - CORS and request validation
  - Runtime instruction construction
  - Chat completion + optional web search completion
  - Suggested product extraction
  - Response formatting before sending back to frontend
- Keeps API keys server-side in Worker secrets.

### products.json

- Product catalog used by the frontend for cards, filtering, and matching.

### secrets.js

- Stores the frontend-accessible Worker URL (`OPENAI_API_URL`).
- Should never contain your OpenAI API key.

## How Data Flows

1. User selects products and enters a message in the browser.
2. `script.js` sends selected products, catalog, conversation context, and preferences to the Worker URL.
3. `RESOURCE_cloudflare-worker.js` validates input and calls OpenAI.
4. Worker returns a normalized response (and optional suggested products).
5. Frontend updates chat, routine summary, and Product Atelier.

## Run Locally

1. Make sure `secrets.js` points to your deployed Cloudflare Worker URL.
2. Serve this folder with a local static server (for example, VS Code Live Server).
3. Open `index.html` through the server URL.

## Notes

- The frontend uses no npm packages and no Node SDK.
- API calls use `messages` and read `data.choices[0].message.content` on chat completion responses.
- Follow-up chat is intentionally constrained to routine and beauty-related topics.
