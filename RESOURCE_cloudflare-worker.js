export default {
  async fetch(request, env) {
    // Step 1: Set CORS + JSON headers so the browser can call this Worker safely.
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json'
    };

    // Step 2: Reply to preflight checks quickly.
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Step 3: Enforce POST because this endpoint expects a JSON payload.
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: { message: 'Method not allowed. Use POST for chat requests.' } }), { status: 405, headers: corsHeaders });
    }

    // Step 4: Read Worker secrets/config once for this request.
    const apiKey = env.OPENAI_API_KEY;
    const assistantId = env.ASSISTANT_ID;
    const openAiModel = typeof env.OPENAI_MODEL === 'string' && env.OPENAI_MODEL.trim()
      ? env.OPENAI_MODEL.trim()
      : 'gpt-4.1';
    const apiBase = 'https://api.openai.com/v1';

    let assistantInstructionsCache = null;

    // Step 5: Load Assistant instructions (if provided) and cache them per request.
    async function getAssistantInstructions() {
      if (!assistantId) {
        return '';
      }

      if (assistantInstructionsCache !== null) {
        return assistantInstructionsCache;
      }

      try {
        const response = await fetch(`${apiBase}/assistants/${assistantId}`, {
          method: 'GET',
          headers: openAiHeaders,
        });

        const data = await response.json();

        if (!response.ok) {
          assistantInstructionsCache = '';
          return '';
        }

        assistantInstructionsCache = typeof data?.instructions === 'string' ? data.instructions.trim() : '';
        return assistantInstructionsCache;
      } catch (error) {
        assistantInstructionsCache = '';
        return '';
      }
    }

    let requestBody;
    try {
      // Step 6: Parse incoming JSON body from the frontend.
      requestBody = await request.json();
    } catch (error) {
      return new Response(JSON.stringify({ error: { message: 'Invalid or empty JSON body. Send a JSON object with a message field.' } }), { status: 400, headers: corsHeaders });
    }

    if (!requestBody || typeof requestBody !== 'object') {
      return new Response(JSON.stringify({ error: { message: 'Invalid request body. Expected a JSON object.' } }), { status: 400, headers: corsHeaders });
    }

    const userMessage = typeof requestBody.message === 'string' ? requestBody.message.trim() : '';
    const threadId = typeof requestBody.threadId === 'string' ? requestBody.threadId : '';
    const mode = requestBody.mode === 'generate_routine' ? 'generate_routine' : 'follow_up';
    const preferences = typeof requestBody.preferences === 'string' ? requestBody.preferences.trim() : '';

    // Step 7: Fail early if the API key was not configured in Worker secrets.
    if (!apiKey) {
      return new Response(JSON.stringify({ error: { message: 'Missing OPENAI_API_KEY in Cloudflare Worker secrets.' } }), { status: 500, headers: corsHeaders });
    }

    // Step 8: Normalize arrays from client so later logic can trust the shape.
    const selectedProducts = normalizeSelectedProducts(requestBody.products);
    const productCatalog = normalizeCatalog(requestBody.catalog);
    const conversation = normalizeConversation(requestBody.conversation);
    const assistantPrompt = userMessage || (mode === 'generate_routine' ? 'Please generate a personalized routine using my selected products.' : '');

    if (!assistantPrompt) {
      return new Response(JSON.stringify({ error: { message: 'Missing user message.' } }), { status: 400, headers: corsHeaders });
    }

    // Step 9: For follow-up mode, keep conversation on allowed routine/beauty topics.
    if (mode === 'follow_up' && !isAllowedFollowUpTopic(assistantPrompt, selectedProducts, productCatalog, conversation)) {
      return new Response(JSON.stringify({
        error: {
          message: 'Follow-up questions must be about your generated routine or beauty topics like skincare, haircare, makeup, and fragrance.',
        },
      }), { status: 400, headers: corsHeaders });
    }

    // Step 10: Build auth headers for OpenAI calls.
    const openAiHeaders = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };

    // --- Search + relevance helpers ---
    function normalizeTextForSearch(text) {
      return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function getSearchKeywords(text) {
      const normalized = normalizeTextForSearch(text);
      const words = normalized.split(' ').filter(Boolean);
      const stopWords = new Set([
        'the', 'and', 'for', 'with', 'that', 'this', 'what', 'which', 'from', 'your', 'you', 'are', 'was', 'were',
        'have', 'has', 'had', 'need', 'want', 'show', 'tell', 'about', 'please', 'product', 'products', 'loreal',
        'l', 'oreal', 'loreals', 'make', 'made', 'good', 'best', 'new', 'other', 'more', 'any', 'some', 'one', 'two'
      ]);

      return Array.from(new Set(words.filter((word) => word.length > 2 && !stopWords.has(word)))).slice(0, 12);
    }

    function scoreCatalogProduct(product, keywords) {
      const haystack = normalizeTextForSearch([
        product.name,
        product.brand,
        product.category,
        product.description,
      ].join(' '));

      let score = 0;

      for (let i = 0; i < keywords.length; i += 1) {
        if (haystack.includes(keywords[i])) {
          score += 1;
        }
      }

      return score;
    }

    function getRelevantCatalogMatches(userPrompt, products) {
      const keywords = getSearchKeywords(userPrompt);

      if (!keywords.length || !Array.isArray(products) || !products.length) {
        return [];
      }

      return products
        .map((product) => ({
          product,
          score: scoreCatalogProduct(product, keywords),
        }))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 3)
        .map((item) => item.product);
    }

    function shouldUseWebSearch(userPrompt, products) {
      if (!Array.isArray(products) || !products.length) {
        return true;
      }

      const promptText = normalizeTextForSearch(userPrompt);
      const searchSignals = [
        'not in catalog',
        'not in the catalog',
        'other products',
        'something else',
        'similar products',
        'web search',
        'find products',
        'recommend products',
        'current products',
        'latest products',
      ];

      for (let i = 0; i < searchSignals.length; i += 1) {
        if (promptText.includes(searchSignals[i])) {
          return true;
        }
      }

      return getRelevantCatalogMatches(userPrompt, products).length === 0;
    }

    function isAllowedFollowUpTopic(userPrompt, selectedProductsValue, catalogValue, conversationValue) {
      const promptText = normalizeTextForSearch(userPrompt);

      if (!promptText) {
        return false;
      }

      // Allow users to start chatting before selecting products.
      if (selectedProductsValue.length === 0 && conversationValue.length === 0) {
        return true;
      }

      const allowedKeywords = [
        'routine', 'step', 'order', 'morning', 'night', 'am', 'pm',
        'how', 'tips', 'application', 'apply',
        'skincare', 'skin', 'cleanser', 'serum', 'moisturizer', 'sunscreen', 'spf', 'toner', 'mask', 'treatment',
        'haircare', 'hair', 'scalp', 'shampoo', 'conditioner',
        'makeup', 'foundation', 'concealer', 'eyeliner', 'eye pencil', 'pencil', 'liner', 'mascara', 'eyeshadow', 'brow', 'lip', 'blush',
        'fragrance', 'perfume', 'scent',
        'acne', 'hydration', 'sensitive', 'dry', 'oily', 'combination',
      ];

      const hasKeywordMatch = allowedKeywords.some((keyword) => promptText.includes(keyword));

      if (hasKeywordMatch) {
        return true;
      }

      if (conversationValue.length > 0 && /\b(this|that|it|they|them|these|those)\b/.test(promptText)) {
        return true;
      }

      const knownNames = [];

      for (let i = 0; i < selectedProductsValue.length; i += 1) {
        knownNames.push(normalizeTextForSearch(selectedProductsValue[i].name));
      }

      for (let i = 0; i < catalogValue.length; i += 1) {
        knownNames.push(normalizeTextForSearch(catalogValue[i].name));
      }

      for (let i = 0; i < knownNames.length; i += 1) {
        if (knownNames[i] && promptText.includes(knownNames[i])) {
          return true;
        }
      }

      return false;
    }

    // --- Output shaping helpers ---
    function appendFallbackNotice(text) {
      const cleanText = String(text || '').trim();

      if (!cleanText) {
        return 'Note: sources unavailable in fallback mode.';
      }

      if (/sources unavailable in fallback mode/i.test(cleanText)) {
        return cleanText;
      }

      return `${cleanText}\n\nNote: sources unavailable in fallback mode.`.trim();
    }

    async function buildChatMessages(modeValue, productsValue, conversationValue, preferenceSummary, userPrompt) {
      const messages = [
        {
          role: 'system',
          content: await buildRuntimeInstructions(modeValue, productsValue, conversationValue, preferenceSummary),
        },
      ];

      for (let i = 0; i < conversationValue.length; i += 1) {
        messages.push({
          role: conversationValue[i].role,
          content: conversationValue[i].content,
        });
      }

      messages.push({
        role: 'user',
        content: userPrompt,
      });

      return messages;
    }

    async function createChatCompletion(modeValue, productsValue, conversationValue, preferenceSummary, userPrompt) {
      // Build a standard chat completion request using mode + app context.
      const response = await fetch(`${apiBase}/chat/completions`, {
        method: 'POST',
        headers: openAiHeaders,
        body: JSON.stringify({
          model: openAiModel,
          messages: await buildChatMessages(modeValue, productsValue, conversationValue, preferenceSummary, userPrompt),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error?.message || 'Failed to create chat completion.');
      }

      const assistantText = data?.choices?.[0]?.message?.content;

      if (typeof assistantText !== 'string' || !assistantText.trim()) {
        throw new Error('Chat completion response text was empty.');
      }

      return assistantText.trim();
    }

    // --- Input normalization helpers ---
    function normalizeSelectedProducts(products) {
      if (!Array.isArray(products)) {
        return [];
      }

      return products
        .slice(0, 20)
        .map((item) => ({
          name: String(item?.name || '').trim(),
          brand: String(item?.brand || '').trim(),
          category: String(item?.category || '').trim(),
          description: String(item?.description || '').trim(),
        }))
        .filter((item) => item.name);
    }

    function normalizeConversation(messages) {
      if (!Array.isArray(messages)) {
        return [];
      }

      return messages
        .map((item) => ({
          role: item?.role === 'assistant' ? 'assistant' : 'user',
          content: String(item?.content || '').trim(),
        }))
        .filter((item) => item.content);
    }

    async function buildRuntimeInstructions(modeValue, productsValue, conversationValue, preferenceSummary) {
      // Build one plain-text instruction block so the model always sees the same structure.
      const assistantInstructions = await getAssistantInstructions();
      const lines = [
        'Runtime context from app:',
      ];

      if (assistantInstructions) {
        lines.push('assistant_instructions=');
        lines.push(assistantInstructions);
      }

      lines.push(`mode=${modeValue}`);

      if (productsValue.length) {
        lines.push('selected_products_json=' + JSON.stringify(productsValue));
      }

      if (conversationValue.length) {
        lines.push('recent_conversation_json=' + JSON.stringify(conversationValue));
      }

      if (productCatalog.length) {
        lines.push('product_catalog_json=' + JSON.stringify(productCatalog));
      }

      if (preferenceSummary) {
        lines.push('user_preference_summary=' + preferenceSummary);
      }

      lines.push('Return plain text only. Do not use markdown tables unless needed.');
      lines.push('When you recommend products, keep the tone friendly, specific, and concise.');

      lines.push('When mode=generate_routine, use only selected_products_json for routine product steps.');
      lines.push('When mode=generate_routine, the first line of the response must be exactly: "Based on your product selection, here is the routine our beauty advisors have put together for you."');
      lines.push('Do not begin with any greeting or preface. Line 2 must begin the routine steps or section headers.');
      lines.push('When mode=generate_routine, include a final "Suggested Products" section with 2 to 4 additional L\'Oréal product options that fit the user request.');
      lines.push('Format the suggested products as bullet points with the exact product name and one short reason.');
      lines.push('When mode=follow_up and the user asks for recommendations, include a "Suggested Products" section with 2 to 4 bullet points.');
      lines.push('Each suggested bullet should start with the product name, followed by a short reason.');
      lines.push('When mode=follow_up, end the response with exactly one short, specific follow-up question.');
      lines.push('The follow-up question must relate to the user\'s routine, concern, product preference, or time of day.');
      lines.push('Do not end with a generic closing like "Let me know if you need anything else."');
      lines.push('When the user asks for a cleanser or any product recommendation, first prioritize specific products from product_catalog_json that match the user concern.');
      lines.push('If product_catalog_json lacks a good match, provide up to 2 clearly labeled general alternatives by product type or ingredients (not fake brand/product names).');
      lines.push('When suggesting catalog items, use product_catalog_json names exactly.');
      lines.push('Prefer recommendations that match the user’s stated concerns and the available catalog items.');

      return lines.join('\n');
    }

    async function buildWebSearchPrompt(modeValue, productsValue, conversationValue, preferenceSummary, userPrompt) {
      // Build a focused web-search prompt with all runtime context included.
      const assistantInstructions = await getAssistantInstructions();
      const lines = [
        'User request: ' + userPrompt,
        'Mode: ' + modeValue,
      ];

      if (assistantInstructions) {
        lines.push('Assistant instructions:');
        lines.push(assistantInstructions);
      }

      if (productsValue.length) {
        lines.push('Selected products JSON: ' + JSON.stringify(productsValue));
      }

      if (productCatalog.length) {
        lines.push('Product catalog JSON: ' + JSON.stringify(productCatalog));
      }

      if (conversationValue.length) {
        lines.push('Recent conversation JSON: ' + JSON.stringify(conversationValue));
      }

      if (preferenceSummary) {
        lines.push('Preference summary: ' + preferenceSummary);
      }

      lines.push('Instructions:');
      lines.push('- Search the web for current L\'Oréal products that match the user request.');
      lines.push('- Prefer L\'Oréal official pages or trustworthy retailers when possible.');
      lines.push('- Return 2 to 4 relevant L\'Oréal product suggestions if catalog matching is weak or missing.');
      lines.push('- Do not invent product names.');
      lines.push('- Include source URLs at the end as plain text under a Sources section.');

      return lines.join('\n');
    }

    // --- Responses API parsing helpers ---
    function extractResponseText(responseData) {
      const outputText = typeof responseData?.output_text === 'string' ? responseData.output_text.trim() : '';
      if (outputText) {
        return outputText;
      }

      const output = Array.isArray(responseData?.output) ? responseData.output : [];
      const textParts = [];

      for (let i = 0; i < output.length; i += 1) {
        const contentBlocks = Array.isArray(output[i]?.content) ? output[i].content : [];

        for (let j = 0; j < contentBlocks.length; j += 1) {
          const block = contentBlocks[j] || {};
          const textValue = typeof block?.text === 'string'
            ? block.text
            : String(block?.text?.value || '').trim();

          if (textValue) {
            textParts.push(textValue);
          }
        }
      }

      return textParts.join('\n\n').trim();
    }

    function extractWebCitations(responseData) {
      const urls = [];
      const seen = new Set();
      const output = Array.isArray(responseData?.output) ? responseData.output : [];

      for (let i = 0; i < output.length; i += 1) {
        const contentBlocks = Array.isArray(output[i]?.content) ? output[i].content : [];

        for (let j = 0; j < contentBlocks.length; j += 1) {
          const annotations = Array.isArray(contentBlocks[j]?.annotations) ? contentBlocks[j].annotations : [];

          for (let k = 0; k < annotations.length; k += 1) {
            const url = String(annotations[k]?.url || '').trim();
            if (!url || seen.has(url)) {
              continue;
            }

            seen.add(url);
            urls.push(url);

            if (urls.length >= 6) {
              return urls;
            }
          }
        }
      }

      return urls;
    }

    function appendSourcesIfMissing(text, citations) {
      const cleanText = String(text || '').trim();
      const links = Array.isArray(citations) ? citations.filter(Boolean) : [];

      if (!links.length || /\bSources\s*:/i.test(cleanText)) {
        return cleanText;
      }

      return `${cleanText}\n\nSources:\n${links.join('\n')}`.trim();
    }

    async function createWebSearchCompletion(modeValue, productsValue, conversationValue, preferenceSummary, userPrompt) {
      // Use OpenAI Responses API with web_search_preview to pull current web-backed suggestions.
      const response = await fetch(`${apiBase}/responses`, {
        method: 'POST',
        headers: openAiHeaders,
        body: JSON.stringify({
          model: openAiModel,
          tools: [{ type: 'web_search_preview' }],
          input: [
            {
              role: 'system',
              content: [
                {
                  type: 'input_text',
                  text: await buildRuntimeInstructions(modeValue, productsValue, conversationValue, preferenceSummary),
                },
              ],
            },
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: await buildWebSearchPrompt(modeValue, productsValue, conversationValue, preferenceSummary, userPrompt),
                },
              ],
            },
          ],
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error?.message || 'Failed to create web search response.');
      }

      const content = extractResponseText(data);
      const citations = extractWebCitations(data);
      return appendSourcesIfMissing(content, citations);
    }

    // --- Product name extraction + cleanup helpers ---
    function normalizeCatalog(products) {
      if (!Array.isArray(products)) {
        return [];
      }

      return products
        .slice(0, 80)
        .map((item) => ({
          id: item?.id,
          name: String(item?.name || '').trim(),
          brand: String(item?.brand || '').trim(),
          category: String(item?.category || '').trim(),
          description: String(item?.description || '').trim(),
        }))
        .filter((item) => item.name);
    }

    function enforceGenerateRoutineOpening(text) {
      const requiredLine = 'Based on your product selection, here is the routine our beauty advisors have put together for you.';
      const raw = String(text || '').trim();

      if (!raw) {
        return requiredLine;
      }

      const requiredIndex = raw.indexOf(requiredLine);

      if (requiredIndex === -1) {
        return `${requiredLine}\n${raw}`;
      }

      const body = raw
        .slice(requiredIndex + requiredLine.length)
        .replace(/^\s*\n+/, '\n')
        .trim();

      return body ? `${requiredLine}\n${body}` : requiredLine;
    }

    function normalizeProducts(products) {
      if (!Array.isArray(products)) {
        return [];
      }

      const cleaned = [];
      const seen = new Set();

      for (let i = 0; i < products.length; i += 1) {
        const item = products[i] || {};
        const name = typeof item === 'string'
          ? cleanProductName(item)
          : cleanProductName(item.name || '');

        if (!name) {
          continue;
        }

        const dedupeKey = name.toLowerCase();
        if (seen.has(dedupeKey)) {
          continue;
        }

        seen.add(dedupeKey);
        cleaned.push({ name });

        if (cleaned.length >= 3) {
          break;
        }
      }

      return cleaned;
    }

    function cleanProductName(rawName) {
      let name = String(rawName || '').trim();

      name = name
        .replace(/\*\*/g, '')
        .replace(/^['"`\-\s]+|['"`\s]+$/g, '')
        .trim();

      if (name.includes(' - ')) {
        name = name.split(' - ')[0].trim();
      }

      if (name.includes(' — ')) {
        name = name.split(' — ')[0].trim();
      }

      if (name.includes(' – ')) {
        name = name.split(' – ')[0].trim();
      }

      if (name.includes(': ')) {
        const parts = name.split(': ');
        const tail = parts.slice(1).join(': ');
        if (/\b(although|this|it|which|that|helps?|provides?|leaves?)\b/i.test(tail) || tail.length > 28) {
          name = parts[0].trim();
        }
      }

      return name.replace(/\s{2,}/g, ' ').trim();
    }

    // --- Suggested product parsing helpers ---
    function extractProductsFromText(text) {
      const normalized = String(text || '').replace(/\r\n/g, '\n');
      const headingRegex = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(?:suggested|recommended)\s+products?\s*:?\s*(?:\*\*)?\s*\n([\s\S]*)/i;
      const headingMatch = normalized.match(headingRegex);
      const section = headingMatch ? headingMatch[1] : normalized;
      const lines = section.split('\n');
      const products = [];
      const seen = new Set();
      const bulletRegex = /^(?:[\-•*]|\d+\.)\s+/;

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i].trim();

        if (!line && products.length > 0) {
          break;
        }

        if (!line) {
          continue;
        }

        if (products.length > 0 && !bulletRegex.test(line)) {
          break;
        }

        const itemText = line.replace(/^(?:[\-•*]|\d+\.)\s+/, '').trim();
        const markdownLinkMatch = itemText.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);

        let rawName = markdownLinkMatch ? markdownLinkMatch[1] : itemText;
        rawName = rawName
          .replace(/\((?:https?:\/\/[^\s)]+)\)$/i, '')
          .replace(/\|\s*https?:\/\/\S+$/i, '')
          .replace(/https?:\/\/\S+/gi, '')
          .trim();

        const name = cleanProductName(rawName);

        if (!name) {
          continue;
        }

        const dedupeKey = name.toLowerCase();
        if (seen.has(dedupeKey)) {
          continue;
        }

        seen.add(dedupeKey);
        products.push({ name });

        if (products.length >= 3) {
          break;
        }
      }

      if (!products.length) {
        const fallbackRegex = /(?:^|\n)(?:[\-•*]|\d+\.)\s+(.+?)\s*$/gim;
        let fallbackMatch;

        while ((fallbackMatch = fallbackRegex.exec(normalized)) !== null) {
          const candidate = String(fallbackMatch[1] || '')
            .replace(/\((?:https?:\/\/[^\s)]+)\)$/i, '')
            .replace(/\|\s*https?:\/\/\S+$/i, '')
            .replace(/https?:\/\/\S+/gi, '')
            .trim();

          const name = cleanProductName(candidate);

          if (!name) {
            continue;
          }

          const dedupeKey = name.toLowerCase();
          if (seen.has(dedupeKey)) {
            continue;
          }

          seen.add(dedupeKey);
          products.push({ name });

          if (products.length >= 3) {
            break;
          }
        }
      }

      return normalizeProducts(products);
    }

    function extractInlineProductMentions(text) {
      const normalized = String(text || '').replace(/\r\n/g, '\n');
      const candidates = [];
      const patterns = [
        /(?:recommend|suggest|try|use)\s+(?:the\s+|a\s+|an\s+|using\s+)?([A-Z][A-Za-z0-9'&\-\s]{3,80})/g,
        /([A-Z][A-Za-z0-9'\-\s]{3,80})\s+(?:is|are)\s+(?:a\s+)?(?:great|good|helpful|effective)\s+(?:option|choice)/g,
        /([A-Z][A-Za-z0-9'&\-]*(?:\s+[A-Z][A-Za-z0-9'&\-]*){0,6}\s+(?:Shampoo|Conditioner|Serum|Cream|Moisturizer|Cleanser|Mask|Treatment|Oil|Gel))/g,
      ];

      for (let i = 0; i < patterns.length; i += 1) {
        let match;

        while ((match = patterns[i].exec(normalized)) !== null) {
          const candidateName = String(match[1] || '')
            .replace(/[.,;!?]+$/g, '')
            .trim();

          if (candidateName) {
            candidates.push({ name: candidateName });
          }
        }
      }

      return normalizeProducts(candidates);
    }

    function appendSuggestedProductsIfMissing(text, products) {
      const cleanText = String(text || '').trim();
      const safeProducts = Array.isArray(products) ? products.filter((item) => item && item.name) : [];

      if (!safeProducts.length) {
        return cleanText;
      }

      if (/\b(?:suggested|recommended)\s+products?\b/i.test(cleanText)) {
        return cleanText;
      }

      const productLines = safeProducts.map((item) => `- ${item.name}`);
      return `${cleanText}\n\nSuggested Products:\n${productLines.join('\n')}`.trim();
    }

    function appendFollowUpQuestionIfMissing(text, modeValue) {
      if (modeValue !== 'follow_up') {
        return String(text || '').trim();
      }

      const cleanText = String(text || '').trim();

      if (!cleanText) {
        return 'What would you like to adjust next?';
      }

      if (/[?？]\s*$/.test(cleanText)) {
        return cleanText;
      }

      return `${cleanText}\n\nWhat would you like to adjust next?`;
    }

    function extractStructuredPayload(text) {
      const raw = String(text || '').trim();

      if (!raw) {
        return { answer: '', products: [] };
      }

      const candidates = [raw];

      const fencedMatch = raw.match(/```json\s*([\s\S]*?)\s*```/i);
      if (fencedMatch && fencedMatch[1]) {
        candidates.push(fencedMatch[1].trim());
      }

      const firstBrace = raw.indexOf('{');
      const lastBrace = raw.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        candidates.push(raw.slice(firstBrace, lastBrace + 1));
      }

      for (let i = 0; i < candidates.length; i += 1) {
        try {
          const candidateText = candidates[i];
          const parsed = JSON.parse(candidateText);
          const answer = typeof parsed.answer === 'string' ? parsed.answer.trim() : '';
          const products = normalizeProducts(parsed.products);

          let textSource = answer;

          if (!textSource) {
            const rawWithoutCandidate = raw.includes(candidateText)
              ? raw.replace(candidateText, '').trim()
              : raw;
            textSource = rawWithoutCandidate;
          }

          const chatAnswer = String(textSource || raw).trim();

          if (chatAnswer || products.length) {
            return { answer: chatAnswer || answer || raw, products };
          }
        } catch (error) {
          // Keep trying other candidate JSON snippets.
        }
      }

      const cleanAnswer = String(raw).trim();
      const sectionProducts = extractProductsFromText(raw);

      // Fallback: if no formal suggested-products section is found,
      // extract likely product names from inline recommendation phrases.
      const inlineProducts = sectionProducts.length ? [] : extractInlineProductMentions(raw);

      return {
        answer: cleanAnswer || raw,
        products: sectionProducts.length ? sectionProducts : inlineProducts,
      };
    }

    // Step 11: Run the model call (web-search first when needed, otherwise chat completion).
    try {
      const shouldSearchWeb = mode === 'follow_up' && shouldUseWebSearch(assistantPrompt, productCatalog);
      let responseText;
      let usedFallbackMode = false;

      if (shouldSearchWeb) {
        try {
          responseText = await createWebSearchCompletion(
            mode,
            selectedProducts,
            conversation,
            preferences,
            assistantPrompt
          );
        } catch (searchError) {
          usedFallbackMode = true;
          responseText = await createChatCompletion(
            mode,
            selectedProducts,
            conversation,
            preferences,
            assistantPrompt
          );
        }
      } else {
        responseText = await createChatCompletion(
          mode,
          selectedProducts,
          conversation,
          preferences,
          assistantPrompt
        );
      }

      const structured = extractStructuredPayload(responseText);
      const baseContent = mode === 'generate_routine'
        ? enforceGenerateRoutineOpening(structured.answer || responseText)
        : (structured.answer || responseText);
      const finalContent = mode === 'follow_up'
        ? appendSuggestedProductsIfMissing(baseContent, structured.products)
        : baseContent;

      const contentWithFollowUp = appendFollowUpQuestionIfMissing(finalContent, mode);

      const contentWithFallbackNote = usedFallbackMode
        ? appendFallbackNotice(contentWithFollowUp)
        : contentWithFollowUp;

      // Step 12: Return a normalized payload used by the frontend UI.
      return new Response(JSON.stringify({
        threadId: threadId || '',
        mode,
        content: contentWithFallbackNote,
        products: structured.products,
      }), { headers: corsHeaders });
    } catch (error) {
      // Step 13: Return a safe error message if anything unexpected fails.
      return new Response(JSON.stringify({
        error: {
          message: error?.message || 'Unexpected worker error.',
        },
      }), {
        status: 500,
        headers: corsHeaders,
      });
    }
  }
};
