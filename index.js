// index.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.static('public')); // Hamare index.html ko serve karne ke liye

// Invidious API ka base URL
const INVIDIOUS_API_BASE = 'https://inv.perditum.com/api/v1';
const INVIDIOUS_DOMAIN = 'https://inv.perditum.com';

// ==========================================================
// HELPER FUNCTIONS (Har kaam ke liye alag function)
// ==========================================================

async function getVideoDetails(videoId) {
    const response = await axios.get(`${INVIDIOUS_API_BASE}/videos/${videoId}`);
    return response.data;
}

async function getComments(videoId) {
    const response = await axios.get(`${INVIDIOUS_API_BASE}/comments/${videoId}`);
    return response.data;
}

async function getTranscript(videoId) {
    // Transcript ke liye 2 step lagte hain: pehle caption URL nikalna, fir usko fetch karna
    const captionsResponse = await axios.get(`${INVIDIOUS_API_BASE}/videos/${videoId}?fields=captions`);
    const captions = captionsResponse.data.captions;

    if (!captions || captions.length === 0) {
        return { error: "No captions available for this video." };
    }
    
    // Pehla available caption URL le lo
    const transcriptPath = captions[0].url;
    const fullTranscriptUrl = `${INVIDIOUS_DOMAIN}${transcriptPath}`;
    
    const transcriptResponse = await axios.get(fullTranscriptUrl);
    return transcriptResponse.data;
}

async function getChannelDetails(channelId) {
    const response = await axios.get(`${INVIDIOUS_API_BASE}/authors/${channelId}`);
    return response.data;
}

async function performSearch(query) {
    const response = await axios.get(`${INVIDIOUS_API_BASE}/search?q=${encodeURIComponent(query)}&type=video`);
    return response.data;
}

// ==========================================================
// ENDPOINT 1: /api/fetch (The Master Endpoint)
// ==========================================================
app.get('/api/fetch', async (req, res) => {
    const { id: videoId, channel: channelId, search: query } = req.query;
    const fields = req.query.fields ? req.query.fields.split(',').map(f => f.trim()) : [];

    if (!videoId && !channelId && !query) {
        return res.status(400).json({ error: "An 'id', 'channel', or 'search' parameter is required." });
    }

    try {
        const tasks = [];
        const responseKeys = [];

        // User ne jo jo maanga hai, uske tasks (promises) banao
        if (videoId) {
            if (fields.includes('details')) { tasks.push(getVideoDetails(videoId)); responseKeys.push('details'); }
            if (fields.includes('comments')) { tasks.push(getComments(videoId)); responseKeys.push('comments'); }
            if (fields.includes('transcript')) { tasks.push(getTranscript(videoId)); responseKeys.push('transcript'); }
        }
        if (channelId && fields.includes('channel')) {
            tasks.push(getChannelDetails(channelId));
            responseKeys.push('channel');
        }
        if (query) {
            tasks.push(performSearch(query));
            responseKeys.push('search_results');
        }
        
        if (tasks.length === 0) {
            return res.status(400).json({ error: "No valid fields or parameters provided." });
        }

        // Saare tasks parallel me run karo aur result ka intezar karo
        // Promise.allSettled() use kar rahe hain taaki agar ek request fail ho to baaki chalti rahein
        const results = await Promise.allSettled(tasks);

        // Final response taiyar karo
        const finalResponse = {};
        results.forEach((result, index) => {
            const key = responseKeys[index];
            if (result.status === 'fulfilled') {
                finalResponse[key] = result.value;
            } else {
                finalResponse[key] = { error: `Failed to fetch ${key}`, details: result.reason.message };
            }
        });

        res.json(finalResponse);

    } catch (error) {
        res.status(500).json({ error: "An unexpected server error occurred.", details: error.message });
    }
});


// ==========================================================
// ENDPOINT 2: /api/analyze_video (The LLM-Friendly Endpoint)
// ==========================================================

// Report ke liye helper functions
const formatNumber = (num) => num ? new Intl.NumberFormat('en-US').format(num) : "N/A";
const formatDate = (dateString) => dateString ? new Date(dateString).toISOString().split('T')[0] : "N/A";

async function generateLlmReport(videoId) {
    // Ek saath details, comments, aur transcript fetch karo
    const results = await Promise.allSettled([
        getVideoDetails(videoId),
        getComments(videoId),
        getTranscript(videoId)
    ]);
    
    const detailsResult = results[0];
    const commentsResult = results[1];
    const transcriptResult = results[2];

    if (detailsResult.status === 'rejected') {
        return `Error: Could not fetch video details for ID ${videoId}. Reason: ${detailsResult.reason.message}`;
    }

    const details = detailsResult.value;
    
    // Channel details alag se nikalo
    let channelDetails = {};
    if (details.authorId) {
        try {
            channelDetails = await getChannelDetails(details.authorId);
        } catch (e) { /* Ignore error if channel details fail */ }
    }
    
    // Transcript text format karo
    const transcriptText = transcriptResult.status === 'fulfilled' && !transcriptResult.value.error
        ? transcriptResult.value.map(line => `(${line.offset / 1000}s) ${line.text}`).join('\n')
        : "Transcript not available.";

    // Top comments format karo
    const topCommentsText = commentsResult.status === 'fulfilled' && commentsResult.value.comments
        ? commentsResult.value.comments
            .sort((a, b) => b.likeCount - a.likeCount)
            .slice(0, 3)
            .map(c => `- **Top Comment (${formatNumber(c.likeCount)} likes):** ${c.content.trim()}`)
            .join('\n')
        : "No comments available or failed to fetch.";

    return `
**YouTube Video Analysis Report**

**1. Basic Information:**
- **Title:** ${details.title || 'N/A'}
- **Views:** ${formatNumber(details.viewCount)}
- **Likes:** ${formatNumber(details.likeCount)}
- **Uploaded On:** ${formatDate(details.published)}

**2. Channel Details:**
- **Channel Name:** ${details.author || 'N/A'}
- **Subscribers:** ${formatNumber(channelDetails.subCount)}
- **Channel ID:** ${details.authorId || 'N/A'}

**3. Video Description:**
${details.description || 'No description provided.'}

**4. Video Transcript (What is being said):**
${transcriptText}

**5. Public Opinion (Top Comments Summary):**
${topCommentsText}

**--- End of Report ---**
    `.trim();
}

app.get('/api/analyze_video', async (req, res) => {
    const { v: videoId } = req.query;
     if (!videoId) {
        return res.status(400).json({ error: "A video ID is required. Use ?v=VIDEO_ID" });
    }
    try {
        const report = await generateLlmReport(videoId);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(report);
    } catch (error) {
        res.status(500).send(`An unexpected error occurred: ${error.message}`);
    }
});


// Server start karo
app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
