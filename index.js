// index.js (DEBUGGING VERSION - TO FIND AND KILL THE BUG)
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
// HELPER FUNCTIONS (The previous version's functions are here)
// ==========================================================
async function getVideoDetails(videoId) { const response = await axios.get(`${INVIDIOUS_API_BASE}/videos/${videoId}`); return response.data; }
async function getComments(videoId) { const response = await axios.get(`${INVIDIOUS_API_BASE}/comments/${videoId}`); return response.data; }
async function getTranscript(videoId) { const captionsResponse = await axios.get(`${INVIDIOUS_API_BASE}/videos/${videoId}?fields=captions`); const captions = captionsResponse.data.captions; if (!captions || captions.length === 0) { throw new Error("No captions available for this video."); } const transcriptPath = captions[0].url; const fullTranscriptUrl = `${INVIDIOUS_DOMAIN}${transcriptPath}`; const transcriptResponse = await axios.get(fullTranscriptUrl); const transcriptData = transcriptResponse.data; if (Array.isArray(transcriptData.captions)) return transcriptData.captions; if (Array.isArray(transcriptData.lines)) return transcriptData.lines; if (Array.isArray(transcriptData)) return transcriptData; throw new Error("Could not find a valid transcript array in the response."); }
async function getChannelDetails(channelId) { const response = await axios.get(`${INVIDIOUS_API_BASE}/authors/${channelId}`); return response.data; }
async function performSearch(query) { const response = await axios.get(`${INVIDIOUS_API_BASE}/search?q=${encodeURIComponent(query)}&type=video`); return response.data; }

// ==========================================================
// ENDPOINT 1: /api/fetch (Known to be working)
// ==========================================================
app.get('/api/fetch', async (req, res) => {
    // This code is unchanged
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
            if (result.status === 'fulfilled') { finalResponse[key] = result.value; } 
            else { finalResponse[key] = { error: `Failed to fetch ${key}`, details: result.reason.message }; }
        });
        res.json(finalResponse);
    } catch (error) { res.status(500).json({ error: "An unexpected server error occurred.", details: error.message }); }
});

// ==========================================================
// NEW DEBUG ENDPOINT - THIS WILL SHOW US THE PROBLEM
// ==========================================================
app.get('/api/debug_video', async (req, res) => {
    const { v: videoId } = req.query;
    if (!videoId) { return res.status(400).json({ error: "A video ID is required." }); }
    
    try {
        // We run the exact same promises as the failing function
        const results = await Promise.allSettled([
            getVideoDetails(videoId),
            getComments(videoId),
            getTranscript(videoId)
        ]);
        
        // But instead of processing, we just return the raw results
        res.json({
            message: "This is the raw data before formatting. The bug is hidden in here.",
            detailsResult: results[0],
            commentsResult: results[1],
            transcriptResult: results[2]
        });

    } catch (error) {
        res.status(500).json({ error: "Even the debug endpoint failed.", details: error.message });
    }
});


// ==========================================================
// ENDPOINT 2: /api/analyze_video (The failing one, left as is for now)
// ==========================================================
const formatNumber = (num) => num != null ? new Intl.NumberFormat('en-US').format(num) : "N/A";
const formatDate = (dateString) => dateString ? new Date(dateString).toISOString().split('T')[0] : "N/A";
async function generateLlmReport(videoId) {
    const results = await Promise.allSettled([getVideoDetails(videoId), getComments(videoId), getTranscript(videoId)]);
    const detailsResult = results[0]; const commentsResult = results[1]; const transcriptResult = results[2];
    if (detailsResult.status === 'rejected') { return `Fatal Error: Could not fetch video details for ID ${videoId}. Reason: ${detailsResult.reason.message}`; }
    const details = detailsResult.value;
    let channelDetails = {};
    if (details.authorId) { try { channelDetails = await getChannelDetails(details.authorId); } catch (e) { /* Fails silently */ } }
    let transcriptText = "Transcript not available.";
    if (transcriptResult.status === 'fulfilled') {
        const transcriptLines = transcriptResult.value;
        transcriptText = transcriptLines.map(line => {
            const timestampInSeconds = (line.start ?? line.offset ?? 0) / 1000;
            const text = line.text || '';
            return `(${timestampInSeconds.toFixed(2)}s) ${text.trim()}`;
        }).join('\n');
    }
    let topCommentsText = "No comments available or failed to fetch.";
    if (commentsResult.status === 'fulfilled' && Array.isArray(commentsResult.value.comments)) {
        topCommentsText = commentsResult.value.comments.sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0)).slice(0, 3).map(c => `- **Top Comment (${formatNumber(c.likeCount)} likes):** ${c.content ? c.content.trim() : ''}`).join('\n');
    }
    return `**YouTube Video Analysis Report**\n\n**1. Basic Information:**\n- **Title:** ${details.title || 'N/A'}\n- **Views:** ${formatNumber(details.viewCount)}\n- **Likes:** ${formatNumber(details.likeCount)}\n- **Uploaded On:** ${formatDate(details.published)}\n\n**2. Channel Details:**\n- **Channel Name:** ${details.author || 'N/A'}\n- **Subscribers:** ${formatNumber(channelDetails.subCount)}\n- **Channel ID:** ${details.authorId || 'N/A'}\n\n**3. Video Description:**\n${details.description ? details.description.trim() : 'No description provided.'}\n\n**4. Video Transcript (What is being said):**\n${transcriptText}\n\n**5. Public Opinion (Top Comments Summary):**\n${topCommentsText}\n\n**--- End of Report ---**`.trim();
}
app.get('/api/analyze_video', async (req, res) => {
    const { v: videoId } = req.query;
     if (!videoId) { return res.status(400).json({ error: "A video ID is required. Use ?v=VIDEO_ID" }); }
    try { const report = await generateLlmReport(videoId); res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.send(report); } catch (error) { res.status(500).send(`An unexpected server error occurred: ${error.message}`); }
});


app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
