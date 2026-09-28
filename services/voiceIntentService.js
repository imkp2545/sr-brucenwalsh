const ACTIONS = new Set([
  'SEARCH_CATALOG', 'OPEN_PRODUCT', 'PRODUCT_PRICE', 'ADD_TO_CART', 'ADD_TO_WISHLIST',
  'REMOVE_FROM_CART', 'UPDATE_CART_QUANTITY', 'REMOVE_FROM_WISHLIST', 'CART_SUMMARY',
  'APPLY_COUPON', 'PRODUCT_DETAILS', 'SIMILAR_PRODUCTS', 'NAVIGATE', 'GO_BACK',
  'SCROLL', 'LOGOUT', 'HELP', 'CLOSE', 'STOP', 'RESUME_NARRATION', 'RESTART_NARRATION', 'UNKNOWN',
]);

const emptyFilters = () => ({
  q: '', category: '', gender: '', tags: '', purchaseMode: '', material: '',
  gemstone: '', color: '', minPrice: null, maxPrice: null,
  sort: 'newest', onSale: false, inStock: false,
});

const normalizeVoiceText = (value) => String(value || '').toLowerCase().replace(/[,]/g, '').trim();

const legacyParseAmount = (text) => {
  const match = text.match(/(?:under|below|less than|up to|upto|within|budget(?: of)?|tak|andar|₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(k|thousand|hazar|hazaar|lakh|lac)?\b/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const multiplier = /lakh|lac/i.test(match[2] || '')
    ? 100000
    : /k|thousand|hazar|hazaar/i.test(match[2] || '') ? 1000 : 1;
  const result = amount * multiplier;
  return result >= 1000 ? result : null;
};

const amountValue = (amount, unit = '') => {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return null;
  const multiplier = /lakh|lac|लाख/i.test(unit)
    ? 100000
    : /k|thousand|hazar|hazaar|हजार/i.test(unit) ? 1000 : 1;
  const result = numeric * multiplier;
  return result >= 1000 ? result : null;
};

const parseAmount = (text) => {
  const match = text.match(/(?:under|below|less than|up to|upto|within|budget(?: of)?|tak|andar|ke andar|से कम|के अंदर|तक|₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(k|thousand|hazar|hazaar|lakh|lac|हजार|लाख)?\b/i);
  return match ? amountValue(match[1], match[2]) : legacyParseAmount(text);
};

const parsePriceRange = (text) => {
  const match = text.match(/(?:between|from)?\s*(\d+(?:\.\d+)?)\s*(k|thousand|hazar|hazaar|lakh|lac|हजार|लाख)?\s*(?:and|to|aur|se|से|और)\s*(\d+(?:\.\d+)?)\s*(k|thousand|hazar|hazaar|lakh|lac|हजार|लाख)?/i);
  if (!match) return null;
  const first = amountValue(match[1], match[2] || match[4]);
  const second = amountValue(match[3], match[4] || match[2]);
  if (first === null || second === null) return null;
  return { minPrice: Math.min(first, second), maxPrice: Math.max(first, second) };
};

const ordinal = (text) => {
  const words = [
    [1, /\b(?:first|one|number one|pehla|pahla)\b|पहला/i],
    [2, /\b(?:second|two|number two|doosra|dusra)\b|दूसरा/i],
    [3, /\b(?:third|three|number three|teesra|tisra)\b|तीसरा/i],
    [4, /\b(?:fourth|four|number four|chautha)\b|चौथा/i],
  ];
  const word = words.find(([, pattern]) => pattern.test(text));
  if (word) return word[0];
  const numeric = text.match(/(?:\b(?:product|piece|item|number)\s*#?\s*(\d+)|\b(\d+)(?:st|nd|rd|th)?\s*(?:number\s*)?(?:product|piece|item)\b)/i);
  return numeric ? Number(numeric[1] || numeric[2]) : 1;
};

const quantity = (text) => {
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  const phrase = text.match(/(?:quantity(?: to)?|make it|change(?: it)? to|add)\s+(\d+|one|two|three|four|five|six)\b/);
  if (!phrase) return 1;
  return Math.min(20, Math.max(1, Number(phrase[1]) || words[phrase[1]] || 1));
};

const legacySearchFilters = (text, previous = {}) => {
  const filters = { ...emptyFilters(), ...previous };
  const categories = ['rings?', 'earrings?', 'necklaces?', 'pendants?', 'bracelets?', 'bangles?', 'mangalsutras?', 'watches?'];
  const category = categories.find((candidate) => new RegExp(`\\b${candidate}\\b`, 'i').test(text));
  if (category) filters.q = category.replace('?', '').replace(/s$/, '');
  const material = ['rose gold', 'gold', 'silver', 'platinum'].find((item) => text.includes(item));
  const gemstone = ['diamond', 'ruby', 'emerald', 'sapphire', 'pearl'].find((item) => text.includes(item));
  if (material) filters.material = material;
  if (gemstone) filters.gemstone = gemstone;
  const amount = parseAmount(text);
  if (amount) filters.maxPrice = amount;
  if (/cheaper|lower price|more affordable|kam budget|sasta/.test(text)) {
    const currentPrice = Number(previous.referencePrice || previous.maxPrice);
    if (Number.isFinite(currentPrice) && currentPrice > 0) {
      filters.maxPrice = Math.max(1000, Math.floor(currentPrice * 0.8));
    }
    filters.sort = 'priceLow';
  }
  if (/latest|new arrival|newest|recent/.test(text)) filters.sort = 'newest';
  if (/offer|sale|discount|deal/.test(text)) filters.onSale = true;
  if (/available|in stock/.test(text)) filters.inStock = true;
  return filters;
};

const CATEGORY_ALIASES = [
  { value: 'rings', pattern: /\b(?:rings?|anguthi|anguthiyan)\b|अंगूठ(?:ी|ियां|ियाँ)/i },
  { value: 'earrings', pattern: /\b(?:earrings?|jhumk[ae]|baliyan)\b|झुमक[ेा]|बालियाँ/i },
  { value: 'necklace', pattern: /\b(?:necklaces?|haar)\b|हार|नेकलेस/i },
  { value: 'pendants', pattern: /\bpendants?\b|पेंडेंट/i },
  { value: 'bracelet', pattern: /\bbracelets?\b|ब्रेसलेट/i },
  { value: 'bangles', pattern: /\b(?:bangles?|kangan)\b|कंगन|चूड़ियाँ/i },
  { value: 'mangalsutra', pattern: /\bmangalsutras?\b|मंगलसूत्र/i },
];
const MATERIALS = [
  ['rose gold', /\brose gold\b|रोज गोल्ड/i],
  ['gold', /\bgold\b|\b(?:sona|sone)\b|सोना|सोने/i],
  ['silver', /\bsilver\b|\bchandi\b|चांदी/i],
  ['platinum', /\bplatinum\b|प्लैटिनम/i],
];
const GEMSTONES = [
  ['diamond', /\bdiamond\b|\b(?:heera|heere)\b|हीरा|हीरे/i],
  ['ruby', /\bruby\b|माणिक/i], ['emerald', /\bemerald\b|पन्ना/i],
  ['sapphire', /\bsapphire\b|नीलम/i], ['pearl', /\bpearl\b|\bmoti\b|मोती/i],
];
const COLORS = [
  ['red', /\bred\b|\blaal\b|लाल/i], ['blue', /\bblue\b|\bneela\b|नीला/i],
  ['green', /\bgreen\b|\bhara\b|हरा/i], ['white', /\bwhite\b|\bsafed\b|सफेद/i],
  ['black', /\bblack\b|\bkala\b|काला/i], ['yellow', /\byellow\b|\bpeela\b|पीला/i],
  ['pink', /\bpink\b|\bgulabi\b|गुलाबी/i],
];

const matchingValue = (text, entries) => entries.find(([, pattern]) => pattern.test(text))?.[0] || '';

const extractSearchFilters = (text, previous = {}) => {
  const filters = { ...emptyFilters(), ...previous };
  let changed = false;
  const clearAll = /\b(?:clear|reset)\b.*\b(?:filters?|everything)\b|\bremove all filters?\b|\b(?:sab|saare) filters? (?:hata|clear)|\bfilters? clear kar do\b|सारे फ़िल्टर हटा दो/i.test(text);
  if (clearAll) return { filters: emptyFilters(), changed: true, cleared: true };

  const remove = (pattern, keys) => {
    if (!pattern.test(text)) return;
    keys.forEach((key) => { filters[key] = ['minPrice', 'maxPrice'].includes(key) ? null : ''; });
    changed = true;
  };
  remove(/(?:remove|clear|hata do|हटा दो).*(?:price|budget|keemat|कीमत)|(?:price|budget|keemat|कीमत).*?(?:hata do|हटा दो)/i, ['minPrice', 'maxPrice']);
  remove(/(?:remove|clear|hata do|हटा दो).*(?:category|type)|(?:category|type).*?(?:hata do|हटा दो)/i, ['category']);
  remove(/(?:remove|clear|hata do|हटा दो).*(?:material|gold|silver|platinum|sona|sone)|(?:material|gold|silver|platinum|sona|sone).*?(?:hata do|हटा दो)/i, ['material']);
  remove(/(?:remove|clear|hata do|हटा दो).*(?:gemstone|diamond|ruby|emerald|sapphire|pearl)|(?:gemstone|diamond|ruby|emerald|sapphire|pearl).*?(?:hata do|हटा दो)/i, ['gemstone']);
  remove(/(?:remove|clear|hata do|हटा दो).*(?:colou?r|red|blue|green|white|black|pink)|(?:colou?r|red|blue|green|white|black|pink).*?(?:hata do|हटा दो)/i, ['color']);
  if (changed) return { filters, changed: true, cleared: false };

  const category = CATEGORY_ALIASES.find(({ pattern }) => pattern.test(text))?.value || '';
  if (category) { filters.category = category; filters.q = ''; changed = true; }
  const goldAsColor = /\bgold\s+(?:colou?r|color mein)\b/i.test(text);
  const material = goldAsColor ? '' : matchingValue(text, MATERIALS);
  const gemstone = matchingValue(text, GEMSTONES);
  const color = goldAsColor ? 'gold' : matchingValue(text, COLORS);
  if (material) filters.material = material;
  if (gemstone) filters.gemstone = gemstone;
  if (color) filters.color = color;
  changed ||= Boolean(material || gemstone || color);

  const range = parsePriceRange(text);
  const amount = range ? null : parseAmount(text);
  if (range) {
    filters.minPrice = range.minPrice;
    filters.maxPrice = range.maxPrice;
    changed = true;
  } else if (amount) {
    filters.maxPrice = amount;
    changed = true;
  }
  if (/\b(?:women|ladies|female)\b|महिला/i.test(text)) { filters.gender = 'women'; changed = true; }
  if (/\b(?:men|gents|male)\b|पुरुष/i.test(text)) { filters.gender = 'men'; changed = true; }
  if (/\b(?:unisex|everyone)\b/.test(text)) { filters.gender = 'unisex'; changed = true; }
  if (/\b(?:appointment|private viewing)\b/.test(text)) { filters.purchaseMode = 'appointmentOnly'; changed = true; }
  if (/\b(?:buy online|online only)\b/.test(text)) { filters.purchaseMode = 'online'; changed = true; }
  if (/cheaper|lower price|more affordable|kam budget|sasta|सस्ता/.test(text)) {
    const currentPrice = Number(previous.referencePrice || previous.maxPrice);
    if (Number.isFinite(currentPrice) && currentPrice > 0) {
      filters.maxPrice = Math.max(1000, Math.floor(currentPrice * 0.8));
    }
    filters.sort = 'priceLow';
    changed = true;
  }
  if (/latest|new arrival|newest|recent/.test(text)) { filters.sort = 'newest'; changed = true; }
  if (/popular|best selling/.test(text)) { filters.sort = 'popular'; changed = true; }
  if (/highest rated|best rated/.test(text)) { filters.sort = 'rating'; changed = true; }
  if (/offer|sale|discount|deal/.test(text)) { filters.onSale = true; changed = true; }
  if (/available|in stock/.test(text)) { filters.inStock = true; changed = true; }
  return { filters, changed, cleared: false };
};

const searchFilters = (text, previous = {}) => {
  const extracted = extractSearchFilters(text, previous);
  return extracted.changed ? extracted.filters : legacySearchFilters(text, previous);
};

const deterministicIntent = (query, context = {}) => {
  const text = normalizeVoiceText(query);
  const base = {
    intent: 'UNKNOWN', replyText: '', filters: emptyFilters(), ordinal: 1,
    quantity: 1, couponCode: '', productIdentifier: '', destination: '',
  };
  if (/^(?:please\s+)?(?:stop|stop speaking|stop it|pause|cancel|enough|shut up|be quiet|bas|ruko|band karo|रुको|बस|बंद करो)[.!\s]*$/.test(text)) {
    return { ...base, intent: 'STOP' };
  }
  if (/^(?:resume|continue|continue explaining|aage bolo|continue karo|resume karo|आगे बोलो)[.!\s]*$/.test(text)) {
    return { ...base, intent: 'RESUME_NARRATION' };
  }
  if (/^(?:start again|start from (?:the )?beginning|explain again|repeat from (?:the )?start|starting se batao|shuru se bolo|शुरू से बताओ)[.!\s]*$/.test(text)) {
    return { ...base, intent: 'RESTART_NARRATION' };
  }
  if (/\b(close|dismiss|minimi[sz]e|go away|band karo)\b/.test(text)) {
    return { ...base, intent: 'CLOSE', replyText: 'Of course. I am here whenever you need me.' };
  }
  if (/\b(go back|previous (?:page|screen)|back please|wapas jao|peeche jao|pichhe jao)\b|वापस जाओ|पीछे जाओ/.test(text)) {
    return { ...base, intent: 'GO_BACK', replyText: 'Going back.' };
  }
  if (/\b(scroll|page)\s+(?:down|neeche)|\bneeche\s+(?:scroll|jao)\b|नीचे (?:स्क्रॉल|जाओ)/.test(text)) {
    return { ...base, intent: 'SCROLL', destination: 'down' };
  }
  if (/\b(scroll|page)\s+(?:up|upar)|\bupar\s+(?:scroll|jao)\b|ऊपर (?:स्क्रॉल|जाओ)/.test(text)) {
    return { ...base, intent: 'SCROLL', destination: 'up' };
  }
  if (/\b(log ?out|sign out)\b/.test(text)) {
    return { ...base, intent: 'LOGOUT', replyText: 'Signing you out.' };
  }
  if (/\b(apply|use)\b.*\b(coupon|code)\b/.test(text)) {
    const code = text.match(/(?:coupon|code)\s+([a-z0-9-]+)/i)?.[1] || '';
    return { ...base, intent: 'APPLY_COUPON', couponCode: code.toUpperCase() };
  }
  if (/\b(what(?:'s| is) in|cart total|bag total|total of|summari[sz]e)\b.*\b(cart|bag)\b|\bhow much is my (?:cart|bag)\b/.test(text)) {
    return { ...base, intent: 'CART_SUMMARY' };
  }
  if (/\b(remove|delete|take out)\b.*\b(cart|bag|item)\b/.test(text)) {
    return { ...base, intent: 'REMOVE_FROM_CART', ordinal: ordinal(text) };
  }
  if (/\b(change|set|update|make)\b.*\b(quantity|qty|item|it)\b|\badd one more\b/.test(text)) {
    return { ...base, intent: 'UPDATE_CART_QUANTITY', ordinal: ordinal(text), quantity: /add one more/.test(text) ? 0 : quantity(text) };
  }
  if (/\b(remove|delete)\b.*\b(wishlist|favourites?|favorites?)\b/.test(text)) {
    return { ...base, intent: 'REMOVE_FROM_WISHLIST', ordinal: ordinal(text) };
  }
  if (/\b(checkout|payment)\b/.test(text)) {
    return { ...base, intent: 'NAVIGATE', destination: '/checkout', requiresAccount: true, replyText: 'Taking you to checkout.' };
  }
  if (/\b(cart|bag)\b/.test(text) && /\b(open|show|view|go|take|dikhao)\b/.test(text)) {
    return { ...base, intent: 'NAVIGATE', destination: '/app/cart', replyText: 'Opening your shopping bag.' };
  }
  if (/\bwishlist\b/.test(text) && /\b(open|show|view|go|take|dikhao)\b/.test(text)) {
    return { ...base, intent: 'NAVIGATE', destination: '/app/wishlist', replyText: 'Opening your wishlist.' };
  }
  if (/\b(profile|account)\b/.test(text)) return { ...base, intent: 'NAVIGATE', destination: '/app/account', replyText: 'Opening your account.' };
  if (/\b(home|homepage|ghar)\b|होम|घर/.test(text)) return { ...base, intent: 'NAVIGATE', destination: '/app/home', replyText: 'Taking you home.' };
  if (/\b(my orders?|order history)\b/.test(text)) return { ...base, intent: 'NAVIGATE', destination: '/orders', requiresAccount: true, replyText: 'Opening your orders.' };
  if (/\b(settings?|preferences?)\b/.test(text)) return { ...base, intent: 'NAVIGATE', destination: '/profile/preferences', requiresAccount: true, replyText: 'Opening your preferences.' };
  if (/\bnotifications?\b/.test(text)) return { ...base, intent: 'NAVIGATE', destination: '/notifications', requiresAccount: true, replyText: 'Opening your notifications.' };
  if (/\baddresses|saved address\b/.test(text)) return { ...base, intent: 'NAVIGATE', destination: '/addresses', requiresAccount: true, replyText: 'Opening your saved addresses.' };
  if (/\bappointments?\b/.test(text)) return { ...base, intent: 'NAVIGATE', destination: '/appointments', requiresAccount: true, replyText: 'Opening your appointments.' };
  if (/\breturns?\b/.test(text)) return { ...base, intent: 'NAVIGATE', destination: '/returns', requiresAccount: true, replyText: 'Opening your returns.' };
  if (/\brefunds?\b/.test(text)) return { ...base, intent: 'NAVIGATE', destination: '/refunds', requiresAccount: true, replyText: 'Opening your refunds.' };
  if (/\bbuyback\b/.test(text)) return { ...base, intent: 'NAVIGATE', destination: '/buyback', requiresAccount: true, replyText: 'Opening buyback.' };
  if (/\bmy reviews?\b/.test(text)) return { ...base, intent: 'NAVIGATE', destination: '/reviews/mine', requiresAccount: true, replyText: 'Opening your reviews.' };
  if (/\b(sign in|log in|login)\b/.test(text)) return { ...base, intent: 'NAVIGATE', destination: '/auth/login', replyText: 'Opening sign in.' };
  if (/\b(shop|store|collections?|explore|browse|dukaan)\b|दुकान/.test(text) && /\b(open|show|view|go|latest|kholo|dikhao)\b|खोलो|दिखाओ/.test(text)) return { ...base, intent: 'NAVIGATE', destination: '/app/explore', replyText: 'Opening the collection.' };
  if (/\b(add|put|place|buy)\b.*\b(cart|bag)\b|\b(cart|bag)\b.*\b(add|put|place)\b/.test(text)) {
    return { ...base, intent: 'ADD_TO_CART', ordinal: ordinal(text), quantity: quantity(text) };
  }
  if (/\b(add|save|put)\b.*\b(wishlist|favourites?|favorites?)\b/.test(text)) {
    return { ...base, intent: 'ADD_TO_WISHLIST', ordinal: ordinal(text) };
  }
  const extractedSearch = extractSearchFilters(text, context.filters || {});
  if (extractedSearch.changed) {
    return {
      ...base,
      intent: 'SEARCH_CATALOG',
      filters: extractedSearch.filters,
      replyText: extractedSearch.cleared ? 'Filters cleared.' : '',
    };
  }
  if (/\b(price|cost|how much)\b/.test(text)) return { ...base, intent: 'PRODUCT_PRICE', ordinal: ordinal(text) };
  if (context.currentProductIdentifier && /\b(material|sizes?|colou?rs?|available|in stock|tell me about|details?)\b/.test(text)) return { ...base, intent: 'PRODUCT_DETAILS', ordinal: ordinal(text) };
  if (/\b(similar|like this|alternatives?)\b/.test(text)) return { ...base, intent: 'SIMILAR_PRODUCTS', ordinal: ordinal(text) };
  const openProductAction = /\b(?:open|view|show me|kholo|open karo)\b|खोलो/i;
  const productReference = /\b(?:product|piece|item|this|number|first|second|third|fourth|pehla|pahla|doosra|dusra|teesra|tisra)\b|(?:पहला|दूसरा|तीसरा|प्रोडक्ट)/i;
  if (
    (openProductAction.test(text) && productReference.test(text))
    || /\b(?:show me)\s+(?:number\s*)?\d+\b/i.test(text)
  ) {
    return { ...base, intent: 'OPEN_PRODUCT', ordinal: ordinal(text) };
  }
  if (/\b(help|what can you do|who are you)\b/.test(text)) {
    return { ...base, intent: 'HELP', replyText: 'I can find jewellery, compare prices, open products, save favourites, add to your bag, and guide you to checkout.' };
  }

  const filters = searchFilters(text, context.filters || {});
  if (/\b(show|find|search|looking for|want|need|collection|jewellery|jewelry|ring|earring|necklace|pendant|bracelet|bangle|diamond|gold|silver|platinum|offer|sale|latest|cheaper)\b/.test(text)) {
    return { ...base, intent: 'SEARCH_CATALOG', filters };
  }
  if (/^(hi|hello|hey|namaste)\b/.test(text)) {
    return { ...base, intent: 'HELP', replyText: 'Hello. What kind of jewellery may I find for you today?' };
  }
  return base;
};

const aiSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    intent: { type: 'string', enum: Array.from(ACTIONS) },
    replyText: { type: 'string' }, ordinal: { type: 'integer' }, quantity: { type: 'integer' },
    couponCode: { type: 'string' },
    productIdentifier: { type: 'string' }, destination: { type: 'string' },
    filters: {
      type: 'object', additionalProperties: false,
      properties: {
        q: { type: 'string' }, category: { type: 'string' }, gender: { type: 'string' },
        tags: { type: 'string' }, purchaseMode: { type: 'string' }, material: { type: 'string' },
        gemstone: { type: 'string' }, color: { type: 'string' },
        minPrice: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        maxPrice: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        sort: { type: 'string', enum: ['newest', 'popular', 'priceLow', 'priceHigh', 'rating'] },
        onSale: { type: 'boolean' }, inStock: { type: 'boolean' },
      },
      required: [
        'q', 'category', 'gender', 'tags', 'purchaseMode', 'material', 'gemstone', 'color',
        'minPrice', 'maxPrice', 'sort', 'onSale', 'inStock',
      ],
    },
  },
  required: ['intent', 'replyText', 'ordinal', 'quantity', 'couponCode', 'productIdentifier', 'destination', 'filters'],
};

const interpretWithOpenAI = async (query, context) => {
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_VOICE_MODEL) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_VOICE_MODEL,
        instructions: 'You are a concise luxury jewellery shopping intent router. Never invent products, prices, IDs, routes, or completed actions. Convert the request into one supported app action. Preserve relevant filters and ordinals from context. Valid destinations are /app/home, /app/cart, /app/wishlist, /app/account, /app/explore, /checkout, /orders, /profile/preferences, /notifications, /addresses, /appointments, /returns, /refunds, /buyback, /reviews/mine, and /auth/login.',
        input: JSON.stringify({ query, context }),
        text: { format: { type: 'json_schema', name: 'voice_intent', strict: true, schema: aiSchema } },
      }),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const output = payload.output
      ?.flatMap((item) => item.content || [])
      .find((item) => item.type === 'output_text')?.text;
    const parsed = output ? JSON.parse(output) : null;
    return parsed && ACTIONS.has(parsed.intent) ? parsed : null;
  } catch (_error) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const interpretVoiceRequest = async (query, context = {}) => {
  const fallback = deterministicIntent(query, context);
  if (fallback.intent !== 'UNKNOWN') return fallback;
  const aiResult = await interpretWithOpenAI(query, context);
  if (!aiResult) return fallback;
  const safeDestinations = new Set([
    '/app/home', '/app/cart', '/app/wishlist', '/app/account', '/app/explore', '/checkout',
    '/orders', '/profile/preferences', '/notifications', '/addresses', '/appointments',
    '/returns', '/refunds', '/buyback', '/reviews/mine', '/auth/login',
  ]);
  if (aiResult.intent === 'NAVIGATE' && !safeDestinations.has(aiResult.destination)) return fallback;
  return aiResult;
};

module.exports = {
  deterministicIntent, interpretVoiceRequest, normalizeVoiceText, parseAmount, parsePriceRange,
  searchFilters, quantity,
};
