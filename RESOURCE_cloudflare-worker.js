export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: { message: 'Method not allowed. Use POST for chat requests.' } }), { status: 405, headers: corsHeaders });
    }

    const apiKey = env.OPENAI_API_KEY;
    const assistantId = env.ASSISTANT_ID;
    const webSearchModel = typeof env.WEB_SEARCH_MODEL === 'string' && env.WEB_SEARCH_MODEL.trim()
      ? env.WEB_SEARCH_MODEL.trim()
      : 'gpt-4o-search-preview';
    const apiBase = 'https://api.openai.com/v1';

    let requestBody;
    try {
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

    if (!apiKey) {
      return new Response(JSON.stringify({ error: { message: 'Missing OPENAI_API_KEY in Cloudflare Worker secrets.' } }), { status: 500, headers: corsHeaders });
    }

    const selectedProducts = normalizeSelectedProducts(requestBody.products);
    const productCatalog = normalizeCatalog(requestBody.catalog);
    const conversation = normalizeConversation(requestBody.conversation);
    const assistantPrompt = userMessage || (mode === 'generate_routine' ? 'Please generate a personalized routine using my selected products.' : '');

    if (!assistantPrompt) {
      return new Response(JSON.stringify({ error: { message: 'Missing user message.' } }), { status: 400, headers: corsHeaders });
    }

    const openAiAssistantsHeaders = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'assistants=v2'
    };

    const openAiResponsesHeaders = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };

    async function createThread() {
      const response = await fetch(`${apiBase}/threads`, {
        method: 'POST',
        headers: openAiAssistantsHeaders,
        body: '{}',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error?.message || 'Failed to create thread.');
      }

      return data.id;
    }

    async function addMessage(activeThreadId) {
      const response = await fetch(`${apiBase}/threads/${activeThreadId}/messages`, {
        method: 'POST',
        headers: openAiAssistantsHeaders,
        body: JSON.stringify({
          role: 'user',
          content: assistantPrompt,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error?.message || 'Failed to add message to thread.');
      }

      return data;
    }

    async function createRun(activeThreadId, runtimeInstructions) {
      const runBody = {
        assistant_id: assistantId,
      };

      if (runtimeInstructions) {
        runBody.additional_instructions = runtimeInstructions;
      }

      const response = await fetch(`${apiBase}/threads/${activeThreadId}/runs`, {
        method: 'POST',
        headers: openAiAssistantsHeaders,
        body: JSON.stringify(runBody),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error?.message || 'Failed to create assistant run.');
      }

      return data.id;
    }

    async function getRun(activeThreadId, runId) {
      const response = await fetch(`${apiBase}/threads/${activeThreadId}/runs/${runId}`, {
        method: 'GET',
        headers: openAiAssistantsHeaders,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error?.message || 'Failed to check assistant run.');
      }

      return data;
    }

    async function getLatestAssistantMessage(activeThreadId, runId) {
      const response = await fetch(`${apiBase}/threads/${activeThreadId}/messages?limit=20`, {
        method: 'GET',
        headers: openAiAssistantsHeaders,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error?.message || 'Failed to read assistant messages.');
      }

      const messages = data.data || [];
      let assistantMessage = messages.find((message) => message.role === 'assistant' && message.run_id === runId);

      if (!assistantMessage) {
        assistantMessage = messages.find((message) => message.role === 'assistant');
      }

      if (!assistantMessage) {
        throw new Error('No assistant message was returned.');
      }

      const textParts = (assistantMessage.content || [])
        .filter((contentBlock) => contentBlock.type === 'text' && contentBlock.text && contentBlock.text.value)
        .map((contentBlock) => contentBlock.text.value.trim())
        .filter(Boolean);

      const assistantText = textParts.join('\n\n');

      if (!assistantText) {
        throw new Error('Assistant response text was empty.');
      }

      return assistantText;
    }

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
        .slice(-12)
        .map((item) => ({
          role: item?.role === 'assistant' ? 'assistant' : 'user',
          content: String(item?.content || '').trim(),
        }))
        .filter((item) => item.content);
    }

    function buildRuntimeInstructions(modeValue, productsValue, conversationValue, preferenceSummary) {
      const lines = [
        'Runtime context from app:',
        `mode=${modeValue}`,
      ];

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

      lines.push('When mode=generate_routine, use only selected_products_json for routine product steps.');
      lines.push('When mode=generate_routine, the first line of the response must be exactly: "Based on your product selection, here is the routine our beauty advisors have put together for you."');
      lines.push('Do not begin with any greeting or preface. Line 2 must begin the routine steps or section headers.');
      lines.push('When the user asks for a cleanser or any product recommendation, choose a specific product from product_catalog_json and name it explicitly; do not answer with a generic category only.');
      lines.push('Prefer recommendations that match the user’s stated concerns and the available catalog items.');
      lines.push('Use live web search for current information (launches, research, ingredients, usage guidance) when relevant.');
      lines.push('When using current information, include source links in a final "Sources:" section.');

      return lines.join('\n');
    }

    function buildWebSearchPrompt(modeValue, productsValue, conversationValue, preferenceSummary, userPrompt) {
      const lines = [];

      lines.push('User request: ' + userPrompt);
      lines.push('Mode: ' + modeValue);

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
      lines.push('- Use only items from Product catalog JSON when naming specific products.');
      lines.push('- For mode=generate_routine, use only Selected products JSON for the routine product steps.');
      lines.push('- For mode=generate_routine, first line must be exactly: "Based on your product selection, here is the routine our beauty advisors have put together for you."');
      lines.push('- Use web search for current and factual details related to L\'Oréal products/routines when needed.');
      lines.push('- End with a "Sources:" section and plain URL bullet points when web info is used.');

      return lines.join('\n');
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
            if (!url) {
              continue;
            }

            if (seen.has(url)) {
              continue;
            }

            seen.add(url);
            urls.push(url);

            if (urls.length >= 8) {
              return urls;
            }
          }
        }
      }

      return urls;
    }

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

    function appendSourcesIfMissing(text, citations) {
      const cleanText = String(text || '').trim();
      const links = Array.isArray(citations) ? citations.filter(Boolean) : [];

      if (!links.length) {
        return cleanText;
      }

      if (/\bSources\s*:/i.test(cleanText)) {
        return cleanText;
      }

      const sourceLines = links.map((url) => `- ${url}`).join('\n');
      return `${cleanText}\n\nSources:\n${sourceLines}`.trim();
    }

    async function createWebSearchResponse(runtimeInstructions, modeValue, productsValue, conversationValue, preferenceSummary, userPrompt) {
      const response = await fetch(`${apiBase}/responses`, {
        method: 'POST',
        headers: openAiResponsesHeaders,
        body: JSON.stringify({
          model: webSearchModel,
          tools: [{ type: 'web_search_preview' }],
          input: [
            {
              role: 'system',
              content: [
                {
                  type: 'input_text',
                  text: runtimeInstructions,
                },
              ],
            },
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: buildWebSearchPrompt(modeValue, productsValue, conversationValue, preferenceSummary, userPrompt),
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
      if (!content) {
        throw new Error('Web search response text was empty.');
      }

      const citations = extractWebCitations(data);
      return {
        content: appendSourcesIfMissing(content, citations),
        citations,
      };
    }

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

    function stripSuggestedProductsBlock(text) {
      const normalized = String(text || '').replace(/\r\n/g, '\n');
      const headingRegex = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(?:suggested|recommended)\s+products?\s*:?\s*(?:\*\*)?\s*\n([\s\S]*)/i;
      const headingMatch = normalized.match(headingRegex);

      if (headingMatch) {
        const headingIndex = normalized.indexOf(headingMatch[0]);
        return normalized.slice(0, headingIndex).trim();
      }

      return normalized.trim();
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

          const cleanAnswer = stripSuggestedProductsBlock(textSource || raw);

          if (cleanAnswer || products.length) {
            return { answer: cleanAnswer || answer || raw, products };
          }
        } catch (error) {
          // Keep trying other candidate JSON snippets.
        }
      }

      const cleanAnswer = stripSuggestedProductsBlock(raw);
      const sectionProducts = extractProductsFromText(raw);
      const inlineProducts = sectionProducts.length ? sectionProducts : extractInlineProductMentions(raw);
      return { answer: cleanAnswer || raw, products: inlineProducts };
    }

    try {
      const runtimeInstructions = buildRuntimeInstructions(mode, selectedProducts, conversation, preferences);
      let activeThreadId = threadId;
      let responseText = '';
      let citations = [];
      let usedWebSearch = false;

      try {
        const webResult = await createWebSearchResponse(
          runtimeInstructions,
          mode,
          selectedProducts,
          conversation,
          preferences,
          assistantPrompt
        );

        responseText = webResult.content;
        citations = webResult.citations;
        usedWebSearch = true;
      } catch (webError) {
        if (!assistantId) {
          throw new Error(`Web search path failed and ASSISTANT_ID is missing for fallback. ${webError?.message || ''}`.trim());
        }

        if (!activeThreadId) {
          activeThreadId = await createThread();
        }

        await addMessage(activeThreadId);
        const runId = await createRun(activeThreadId, runtimeInstructions);

        let runData = await getRun(activeThreadId, runId);
        let attempts = 0;

        while (runData.status === 'queued' || runData.status === 'in_progress') {
          if (attempts >= 15) {
            throw new Error('Assistant response timed out.');
          }

          await new Promise((resolve) => setTimeout(resolve, 1000));
          runData = await getRun(activeThreadId, runId);
          attempts += 1;
        }

        if (runData.status !== 'completed') {
          throw new Error(`Assistant run ended with status: ${runData.status}`);
        }

        responseText = await getLatestAssistantMessage(activeThreadId, runId);
      }

      const structured = extractStructuredPayload(responseText);
      const finalContent = mode === 'generate_routine'
        ? enforceGenerateRoutineOpening(structured.answer || responseText)
        : (structured.answer || responseText);

      return new Response(JSON.stringify({
        threadId: activeThreadId || threadId || '',
        mode,
        content: finalContent,
        products: structured.products,
        citations,
        webSearchUsed: usedWebSearch,
      }), { headers: corsHeaders });
    } catch (error) {
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
