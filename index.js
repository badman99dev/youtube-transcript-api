// index.js
const express = require('express');
const axios = require('axios');
const cors = require('cors'); // CORS को इम्पोर्ट करना
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs').promises;
const path = require('path');
const lockfile = require('proper-lockfile');
require('dotenv').config();

// --- Express App Setup ---
const app = express();

// =================================================================
// >> यह सबसे महत्वपूर्ण हिस्सा है CORS के लिए <<
// इसे सभी API राउट्स से पहले होना चाहिए
app.use(cors()); 
// =================================================================

app.use(express.json());
app.use(express.static('public')); // Frontend फाइलों को सर्व करना

// ... (बाकी का पूरा कोड वैसा ही रहेगा जैसा मैंने पिछले जवाब में दिया था) ...
// (ANALYTICS LOGIC, PROMPTS AND CORE API LOGIC, API ENDPOINTS, START SERVER)
// ... (कृपया सुनिश्चित करें कि बाकी का पूरा कोड नीचे मौजूद है) ...


// ===================================================================
// ANALYTICS LOGIC (analytics.js से सीधे यहाँ लाया गया)
// ===================================================================
const DATA_DIR = process.env.VERCEL ? '/tmp' : './data';
const COUNTS_FILE = path.join(DATA_DIR, "request_counts.json");
const TIMES_FILE = path.join(DATA_DIR, "request_times.json");

(async () => { try { await fs.access(DATA_DIR); } catch { await fs.mkdir(DATA_DIR, { recursive: true }); } })();

async function _loadJson(filePath) { try { await fs.access(filePath); const content = await fs.readFile(filePath, 'utf-8'); return JSON.parse(content); } catch { return {}; } }
async function _saveJson(filePath, data) { await fs.writeFile(filePath, JSON.stringify(data, null, 2)); }
async function recordRequest(duration = null, numResults = null) {
    const today = new Date().toISOString().split('T')[0];
    let release;
    try {
        const lockPath = path.join(DATA_DIR, 'analytics.lock');
        release = await lockfile.lock(DATA_DIR, { lockfilePath: lockPath, retries: 3 });
        const counts = await _loadJson(COUNTS_FILE);
        counts[today] = (counts[today] || 0) + 1;
        await _saveJson(COUNTS_FILE, counts);
        if (duration !== null && (numResults === null || numResults === 4)) {
            const times = await _loadJson(TIMES_FILE);
            if (!times[today]) { times[today] = []; }
            times[today].push(Math.round(duration * 100) / 100);
            await _saveJson(TIMES_FILE, times);
        }
    } catch (err) { console.error("Failed to record analytics:", err); } finally { if (release) { await release(); } }
}
async function getLastNDaysData(n = 14) {
    const counts = await _loadJson(COUNTS_FILE); const records = [];
    for (let i = 0; i < n; i++) {
        const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); const dayStr = d.toISOString().split('T')[0];
        records.push({ date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), count: counts[dayStr] || 0 });
    } return records;
}
async function getLastNDaysAvgTimeData(n = 14) {
    const times = await _loadJson(TIMES_FILE); const records = [];
    for (let i = 0; i < n; i++) {
        const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); const dayStr = d.toISOString().split('T')[0];
        const dayTimes = times[dayStr] || [];
        const avgTime = dayTimes.length > 0 ? Math.round((dayTimes.reduce((a, b) => a + b, 0) / dayTimes.length) * 100) / 100 : 0;
        records.push({ date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), avg_time: avgTime });
    } return records;
}

// ===================================================================
// PROMPTS AND CORE API LOGIC
// ===================================================================
const PROMPT_NORMAL = `Based on the user's original query, provide a concise summary... USER'S QUERY: "{query}" TEXT TO SUMMARIZE: --- {context_text} ---`;
const PROMPT_DEEP = `As a meticulous research analyst... **Current Date:** {current_date}. **User's Original Query:** "{query}" ... **Provided Search Results:** --- {context_text} ---`;

async function searchWebLogic(query, serperApiKey, searchType, numResults) { 
    const startTime = Date.now();
    if (!serperApiKey) return { error: "Error: Serper API Key is required." };
    const endpoint = searchType === "news" ? "https://google.serper.dev/news" : "https://google.serper.dev/search";
    const payload = { q: query, num: Math.max(1, Math.min(20, numResults)) };
    const headers = { "X-API-KEY": serperApiKey, "Content-Type": "application/json" };
    try {
        const resp = await axios.post(endpoint, payload, { headers });
        const results = resp.data[searchType === "news" ? "news" : "organic"] || [];
        if (!results.length) return { content: `No results found for '${query}'.` };
        const responses = await Promise.all(results.map(r => axios.get(r.link, { timeout: 20000 }).catch(() => null)));
        let chunks = [], successfulExtractions = 0;
        for (let i = 0; i < results.length; i++) {
            if (!responses[i] || !responses[i].data) continue;
            const dom = new JSDOM(responses[i].data, { url: results[i].link });
            const article = new Readability(dom.window.document).parse();
            if (!article || !article.textContent) continue;
            successfulExtractions++;
            chunks.push(`## ${results[i].title}\n**URL:** ${results[i].link}\n\n${article.textContent.trim()}\n`);
        }
        if (!chunks.length) return { content: `Found results, but couldn't extract content.` };
        await recordRequest((Date.now() - startTime) / 1000, numResults);
        return { content: `Successfully extracted from ${successfulExtractions}/${results.length} results.\n\n---\n\n` + chunks.join("\n---\n") };
    } catch (e) { return { error: `Search error: ${e.message}` }; }
}
async function summarizeWithGemini(textToSummarize, query, geminiKey, modelName, researchMode) {
    try {
        const genAI = new GoogleGenerativeAI(geminiKey);
        const model = genAI.getGenerativeModel({ model: modelName });
        const promptTemplate = researchMode === 'deep' ? PROMPT_DEEP : PROMPT_NORMAL;
        const prompt = promptTemplate.replace('{query}', query).replace('{context_text}', textToSummarize).replace('{current_date}', new Date().toISOString().split('T')[0]);
        const result = await model.generateContent(prompt);
        return (await result.response).text();
    } catch (e) { return `\n\n--- ⚠️ Gemini Summarization Failed ---\nError: ${e.message}`; }
}

// ===================================================================
// API ENDPOINTS
// ===================================================================
app.post('/api/search', async (req, res) => {
    const { query, serper_api_key, search_type, num_results, gemini_api_key, gemini_model, research_mode } = req.body;
    const serperKey = serper_api_key || process.env.SERPER_API_KEY;
    const geminiKey = gemini_api_key || process.env.GEMINI_API_KEY;
    const { content: scrapedText, error } = await searchWebLogic(query, serperKey, search_type, num_results);
    if (error) return res.status(500).json({ result: error });
    if (geminiKey && scrapedText) {
        const summarizedText = await summarizeWithGemini(scrapedText, query, geminiKey, gemini_model, research_mode);
        return res.json({ result: summarizedText.includes("⚠️") ? scrapedText + summarizedText : summarizedText });
    }
    res.json({ result: scrapedText });
});

app.get('/api/analytics', async (req, res) => {
    try {
        const [requestsData, avgTimeData] = await Promise.all([getLastNDaysData(14), getLastNDaysAvgTimeData(14)]);
        res.json({ requestsData, avgTimeData });
    } catch (e) { res.status(500).json({ error: "Failed to fetch analytics data." }); }
});

// ===================================================================
// START SERVER
// ===================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
module.exports = app;
