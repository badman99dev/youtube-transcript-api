// index.js (THE FINAL, ALL-IN-ONE MASTER CODE)
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
// UTILITY & FORMATTING FUNCTIONS
// ==========================================================

function parseWebVTT(vttString) {
    if (typeof vttString !== 'string') return [];
    const lines = vttString.split('\n');
    const transcript = [];
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('-->')) {
            const timeParts = lines[i].split(' --> ');
            const startTime = timeParts[0];
            const timeSegments = startTime.split(':');
            const seconds = parseInt(timeSegments[0], 10) * 3600 + parseInt(timeSegments[1], 10) * 60 + parseFloat(timeSegments[2]);
            let text = '';
            let j = i + 1;
            while (j < lines.length && lines[j] !== '') { text += lines[j] + ' '; j++; }
            transcript.push({ start: seconds * 1000, text: text.trim() });
            i = j;
        }
    }
    return transcript;
}

const formatNumber = (num) => num != null ? new Intl.NumberFormat('en-US').format(num) : "N/A";
const formatDate = (dateString) => dateString ? new Date(dateString).toISOString().split('T')[0] : "N/A";

// ==========================================================
// CORE API HELPER FUNCTIONS
// ==========================================================
async function getVideoDetails(videoId) { const response = await axios.get(`${INVIDIOUS_API_BASE}/videos/${videoId}`); return response.data; }
async function getComments(videoId) { const response = await axios.get(`${INVIDIOUS_API_BASE}/comments/${videoId}`); return response.data; }
async function getChannelDetails(channelId) { const response = await axios.get(`${INVIDIOUS_API_BASE}/authors/${channelId}`); return response.data; }
async function performSearch(query) { const response = await axios.get(`${INVIDIOUS_API_BASE}/search?q=${encodeURIComponent(query)}&type=video`); return response.data; }

async function getTranscript(videoId) {
    const captionsResponse = await axios.get(`${INVIDIOUS_API_BASE}/videos/${videoId}?fields=captions`);
    const captions = captionsResponse.data.captions;
    if (!captions || captions.length === 0) { throw new Error("No captions available for this video."); }
    const transcriptPath = captions[0].url;
    const fullTranscriptUrl = `${INVIDIOUS_DOMAIN}${transcriptPath}`;
    const transcriptResponse = await axios.get(fullTranscriptUrl);
    const data = transcriptResponse.data;

    if (typeof data === 'string') { return parseWebVTT(data); }
    if (typeof data === 'object') {
        if (Array.isArray(data.captions)) return data.captions;
        if (Array.isArray(data.lines)) return data.lines;
        if (Array.isArray(data)) return data;
    }
    throw new Error("Could not parse transcript from the received data.");
}


// ==========================================================
// ENDPOINT 1: /api/fetch (Raw Data Forwarder)
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
            if (result.status === 'fulfilled') { finalResponse[key] = result.value; } 
            else { finalResponse[key] = { error: `Failed to fetch ${key}`, details: result.reason?.message || 'Unknown error' }; }
        });
        res.json(finalResponse);
    } catch (error) { res.status(500).json({ error: "An unexpected server error occurred.", details: error.message }); }
});

// ==========================================================
// ENDPOINT 2: /api/analyze_video (Formatted Report for one Video)
// ==========================================================
async function generateLlmReport(videoId) {
    const results = await Promise.allSettled([getVideoDetails(videoId), getComments(videoId), getTranscript(videoId)]);
    const [detailsResult, commentsResult, transcriptResult] = results;
    if (detailsResult.status === 'rejected') { const reason = detailsResult.reason?.message || 'Could not fetch video details'; return `Fatal Error: ${reason}`; }
    const details = detailsResult.value;
    let channelDetails = {};
    if (details.authorId) { try { channelDetails = await getChannelDetails(details.authorId); } catch (e) {} }
    
    let transcriptText = "Transcript not available.";
    if (transcriptResult.status === 'fulfilled') {
        const transcriptLines = transcriptResult.value;
        if (Array.isArray(transcriptLines) && transcriptLines.length > 0) {
            transcriptText = transcriptLines.map(line => {
                const timestampInSeconds = (line.start ?? line.offset ?? 0) / 1000;
                const text = line.text || '';
                return `(${timestampInSeconds.toFixed(2)}s) ${text.trim()}`;
            }).join('\n');
        }
    }

    let topCommentsText = "No comments available or failed to fetch.";
    if (commentsResult.status === 'fulfilled' && Array.isArray(commentsResult.value.comments)) {
        topCommentsText = commentsResult.value.comments.sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0)).slice(0, 3).map(c => `- **Top Comment (${formatNumber(c.likeCount)} likes):** ${c.content ? c.content.trim() : ''}`).join('\n');
    }

    return `**YouTube Video Analysis Report**\n\n**1. Basic Information:**\n- **Title:** ${details.title || 'N/A'}\n- **Views:** ${formatNumber(details.viewCount)}\n- **Likes:** ${formatNumber(details.likeCount)}\n- **Uploaded On:** ${formatDate(details.published)}\n\n**2. Channel Details:**\n- **Channel Name:** ${details.author || 'N/A'}\n- **Subscribers:** ${formatNumber(channelDetails.subCount)}\n- **Channel ID:** ${details.authorId || 'N/A'}\n\n**3. Video Description:**\n${details.description ? details.description.trim() : 'No description provided.'}\n\n**4. Video Transcript (What is being said):**\n${transcriptText}\n\n**5. Public Opinion (Top Comments Summary):**\n${topCommentsText}\n\n**--- End of Report ---**`.trim();
}

app.get('/api/analyze_video', async (req, res) => {
    const { v: videoId } = req.query;
    if (!videoId) { return res.status(400).json({ error: "A video ID is required." }); }
    try {
        const report = await generateLlmReport(videoId);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(report);
    } catch (error) { res.status(500).send(`An unexpected server error occurred: ${error.message}`); }
});

// ==========================================================
// ENDPOINT 3: /api/analyze_search (Formatted Search Results for LLM)
// ==========================================================
async function generateLlmSearchReport(query) {
    const searchResults = await performSearch(query);
    if (!searchResults || searchResults.length === 0) {
        return { message: "No search results found.", results: [] };
    }

    // NOTE: Getting subscribers requires an extra API call for EACH video. This can be slow.
    const channelDetailPromises = searchResults.map(video => getChannelDetails(video.authorId));
    const channelDetailsResults = await Promise.allSettled(channelDetailPromises);
    
    const formattedResults = searchResults.map((video, index) => {
        const channelData = channelDetailsResults[index].status === 'fulfilled' ? channelDetailsResults[index].value : {};
        return {
            title: video.title,
            videoId: video.videoId,
            uploadDate: video.publishedText || 'N/A', // Invidious search provides this directly
            views: formatNumber(video.viewCount),
            channelName: video.author,
            channelId: video.authorId,
            isVerified: video.authorVerified || false,
            subscribers: formatNumber(channelData.subCount) // This might be N/A if channel fetch fails
        };
    });

    return { results: formattedResults };
}

app.get('/api/analyze_search', async (req, res) => {
    const { q: query } = req.query;
    if (!query) { return res.status(400).json({ error: "A search query 'q' is required." }); }
    try {
        const report = await generateLlmSearchReport(query);
        res.json(report);
    } catch (error) { res.status(500).json({ error: `An unexpected error occurred during search: ${error.message}` }); }
});


app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
