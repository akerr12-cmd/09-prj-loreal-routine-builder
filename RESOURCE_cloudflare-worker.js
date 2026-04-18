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

    if (!apiKey || !assistantId) {
      return new Response(JSON.stringify({ error: { message: 'Missing OPENAI_API_KEY or ASSISTANT_ID in Cloudflare Worker secrets.' } }), { status: 500, headers: corsHeaders });
    }

    if (!userMessage) {
      return new Response(JSON.stringify({ error: { message: 'Missing user message.' } }), { status: 400, headers: corsHeaders });
    }

    const openAiHeaders = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'assistants=v2'
    };

    async function createThread() {
      const response = await fetch(`${apiBase}/threads`, {
        method: 'POST',
        headers: openAiHeaders,
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
        headers: openAiHeaders,
        body: JSON.stringify({
          role: 'user',
          content: userMessage,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error?.message || 'Failed to add message to thread.');
      }

      return data;
    }

    async function createRun(activeThreadId) {
      const response = await fetch(`${apiBase}/threads/${activeThreadId}/runs`, {
        method: 'POST',
        headers: openAiHeaders,
        body: JSON.stringify({
          assistant_id: assistantId,
          additional_instructions: [
            'Treat each new user message as a continuation of the same conversation unless the user clearly starts a new topic.',
            'If the user is answering your previous question, do not restart; continue from the prior turn naturally.',
            'Only answer questions related to L\'Oreal products, ingredients, routines, beauty concerns, or usage guidance.',
            'If the user asks an unrelated question, set answer to exactly: "I can only help with L\'Oreal products, ingredients, and beauty routines."',
            'Return a valid JSON object with this shape: {"answer":"string","products":[{"name":"string"}]}.',
            'The answer field must contain the conversational reply for chat.',
            'When recommending products, include them in products as up to 3 L\'Oreal product names. Do not include links or URLs. If no product is recommended, return an empty products array.'
          ].join(' '),
        }),
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
        headers: openAiHeaders,
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
        headers: openAiHeaders,
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

    let activeThreadId = threadId;

    if (!activeThreadId) {
      activeThreadId = await createThread();
    }

    await addMessage(activeThreadId);
    const runId = await createRun(activeThreadId);

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

    const assistantText = await getLatestAssistantMessage(activeThreadId, runId);
    const structured = extractStructuredPayload(assistantText);

    return new Response(JSON.stringify({
      threadId: activeThreadId,
      content: structured.answer || assistantText,
      products: structured.products,
    }), { headers: corsHeaders });
  }
};
