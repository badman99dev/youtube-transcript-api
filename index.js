// index.js (FINAL & CORRECTED)
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static('public'));

const INVIDIOUS_API_BASE = 'https://inv.perditum.com/api/v1';
const INVIDIOUS_DOMAIN = 'https://inv.perditum.com';

// ==========================================================
// HELPER FUNCTIONS
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
    const captionsResponse = await axios.get(`${INVIDIOUS_API_BASE}/videos/${videoId}?fields=captions`);
    const captions = captionsResponse.data.captions;
    if (!captions || captions.length === 0) {
        throw new Error("No captions available for this video.");
    }
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
// ENDPOINT 1: /api/fetch
// ==========================================================
app.get('/api/fetch', async (req, res) => {
    const { id: videoId, channel: channelId, search: query } = req.query;
    const fields = req.query.fields ? req.query.fields.split(',').map(f => f.trim()) : [];
    if (!videoId && !channelId && !query) { return res.status(400).json({ error: "An 'id', 'channel', or 'search' parameter is required." }); }
    try {
        const tasks = []; const responseKeys = [];
        if (videoId) {
            if (fields.includes('details')) { tasks.push(getVideoDetails(videoId)); responseKeys.push('details'); }
            if (fields.includes('comments')) { tasks.push(getComments(videoId)); responseKeys.push('comments'); }
            if (fields.includes('transcript')) { tasks.push(getTranscript(videoId)); responseKeys.push('transcript'); }
        }
        if (channelId && fields.includes('channel')) { tasks.push(getChannelDetails(channelId)); responseKeys.push('channel'); }
        if (query) { tasks.push(performSearch(query)); responseKeys.push('search_results'); }
        if (tasks.length === 0) { return res.status(400).json({ error: "No valid fields or parameters provided." }); }
        
        const results = await Promise.allSettled(tasks);
        const finalResponse = {};
        results.forEach((result, index) => {
            const key = responseKeys[index];
            if (result.status === 'fulfilled') { 
                finalResponse[key] = result.value; 
            } else { 
                // This now safely handles empty reasons
                finalResponse[key] = { error: `Failed to fetch ${key}`, details: result.reason?.message || 'Unknown error' }; 
            }
        });
        res.json(finalResponse);
    } catch (error) { res.status(500).json({ error: "An unexpected server error occurred.", details: error.message }); }
});

// ==========================================================
// ENDPOINT 2: /api/analyze_video
// ==========================================================

const formatNumber = (num) => num != null ? new Intl.NumberFormat('en-US').format(num) : "N/A";
const formatDate = (dateString) => dateString ? new Date(dateString).toISOString().split('T')[0] : "N/A";

async function generateLlmReport(videoId) {
    const results = await Promise.allSettled([
        getVideoDetails(videoId),
        getComments(videoId),
        getTranscript(videoId)
    ]);
    
    const detailsResult = results[0];
    const commentsResult = results[1];
    const transcriptResult = results[2];

    if (detailsResult.status === 'rejected') {
        const reason = detailsResult.reason?.message || 'Could not fetch video details';
        return `Fatal Error: ${reason}`;
    }
    const details = detailsResult.value;

    let channelDetails = {};
    if (details.authorId) {
        try { channelDetails = await getChannelDetails(details.authorId); } catch (e) { /* Fails silently */ }
    }
    
    let transcriptText = "Transcript not available.";
    if (transcriptResult.status === 'fulfilled') {
        const transcriptData = transcriptResult.value;
        let transcriptLines = [];
        if (Array.isArray(transcriptData.captions)) transcriptLines = transcriptData.captions;
        else if (Array.isArray(transcriptData.lines)) transcriptLines = transcriptData.lines;
        else if (Array.isArray(transcriptData)) transcriptLines = transcriptData;

        if (transcriptLines.length > 0) {
            transcriptText = transcriptLines.map(line => {
                const timestampInSeconds = (line.start ?? line.offset ?? 0) / 1000;
                const text = line.text || '';
                return `(${timestampInSeconds.toFixed(2)}s) ${text.trim()}`;
            }).join('\n');
        }
    }

    let topCommentsText = "No comments available or failed to fetch.";
    if (commentsResult.status === 'fulfilled' && Array.isArray(commentsResult.value.comments)) {
        topCommentsText = commentsResult.value.comments
            .sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0))
            .slice(0, 3)
            .map(c => `- **Top Comment (${formatNumber(c.likeCount)} likes):** ${c.content ? c.content.trim() : ''}`)
            .join('\n');
    }

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
${details.description ? details.description.trim() : 'No description provided.'}

**4. Video Transcript (What is being said):**
${transcriptText}

**5. Public Opinion (Top Comments Summary):**
${topCommentsText}

**--- End of Report ---**
    `.trim();
}

app.get('/api/analyze_video', async (req, res) => {
    const { v: videoId } = req.query;
    if (!videoId) { return res.status(400).json({ error: "A video ID is required. Use ?v=VIDEO_ID" }); }
    try {
        const report = await generateLlmReport(videoId);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(report);
    } catch (error) {
        res.status(500).send(`An unexpected server error occurred: ${error.message}`);
    }
});

// We don't need the debug endpoint anymore.
// app.get('/api/debug_video', ...);

app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
