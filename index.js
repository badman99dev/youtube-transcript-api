// ==========================================================
//  1. SETUP AND IMPORTS
// ==========================================================

// Import necessary packages
const express = require('express'); // Web server framework
const cors = require('cors');       // To allow requests from other websites
const axios = require('axios');     // To make HTTP requests to the Invidious API
const { URL } = require('url');     // To safely manipulate URL parameters

// Define constants for the application
const app = express();
const PORT = process.env.PORT || 3000; // Use port from environment or default to 3000
const INVIDIOUS_API_BASE = 'https://inv.perditum.com/api/v1';
const INVIDIOUS_DOMAIN = 'https://inv.perditum.com';

// Apply middleware
app.use(cors()); // Enable Cross-Origin Resource Sharing
app.use(express.static('public')); // Serve static files from the 'public' folder


// ==========================================================
//  2. UTILITY & FORMATTING HELPERS
// ==========================================================
function parseWebVTT(vttString) { /* ... (same as previous final version) ... */ }
const formatNumber = (num) => num != null ? new Intl.NumberFormat('en-US').format(num) : "N/A";
const formatDate = (dateString) => dateString ? new Date(dateString).toISOString().split('T')[0] : "N/A";
function formatDuration(totalSeconds) { /* ... (same as previous final version) ... */ }
function formatTimestamp(totalSeconds) { /* ... (same as previous final version) ... */ }

/**
 * NEW HELPER: Processes raw video details to extract and format clean stream links.
 * @param {Object} details - The raw video details object from Invidious.
 * @returns {Object} A structured object with categorized stream links.
 */
function getFormattedStreams(details) {
    const streams = {
        video_with_audio: [],
        video_only: [],
        audio_only: []
    };

    const processUrl = (baseUrl) => {
        try {
            const url = new URL(baseUrl);
            url.searchParams.set('local', 'false'); // Enforce high-speed streaming
            return url.toString();
        } catch (error) {
            return baseUrl; // Return original if it's not a valid URL
        }
    };

    // Process combined audio/video streams
    if (Array.isArray(details.formatStreams)) {
        details.formatStreams.forEach(stream => {
            streams.video_with_audio.push({
                quality: stream.qualityLabel || stream.resolution || 'N/A',
                type: stream.type,
                url: processUrl(stream.url)
            });
        });
    }

    // Process separate (adaptive) streams
    if (Array.isArray(details.adaptiveFormats)) {
        details.adaptiveFormats.forEach(stream => {
            const streamInfo = {
                quality: stream.qualityLabel || stream.resolution || 'N/A',
                type: stream.type,
                url: processUrl(stream.url)
            };

            if (stream.type.startsWith('video/')) {
                streams.video_only.push(streamInfo);
            } else if (stream.type.startsWith('audio/')) {
                // For audio, bitrate is a better quality indicator
                streamInfo.quality = `${Math.round(stream.bitrate / 1000)}kbps`;
                streams.audio_only.push(streamInfo);
            }
        });
    }

    return streams;
}


// ==========================================================
//  3. CORE API DATA FETCHERS
// ==========================================================
async function getVideoDetails(videoId) { const response = await axios.get(`${INVIDIOUS_API_BASE}/videos/${videoId}`); return response.data; }
async function getComments(videoId) { const response = await axios.get(`${INVIDIOUS_API_BASE}/comments/${videoId}`); return response.data; }
async function getChannelDetails(channelId) { const response = await axios.get(`${INVIDIOUS_API_BASE}/authors/${channelId}`); return response.data; }
async function performSearch(query) { const searchUrl = `${INVIDIOUS_API_BASE}/search?q=${encodeURIComponent(query)}`; const response = await axios.get(searchUrl); return response.data; }
async function getTranscript(videoId) { /* ... (same as previous final version) ... */ }


// ==========================================================
//  4. PUBLIC API ENDPOINTS
// ==========================================================

// ENDPOINT 1: /api/fetch (Raw Data Forwarder)
app.get('/api/fetch', async (req, res) => { /* ... (no changes needed) ... */ });

// NEW ENDPOINT: /api/streams
app.get('/api/streams', async (req, res) => {
    const { v: videoId } = req.query;
    if (!videoId) {
        return res.status(400).json({ error: "A video ID 'v' is required." });
    }
    try {
        const details = await getVideoDetails(videoId);
        const streams = getFormattedStreams(details);
        res.json(streams);
    } catch (error) {
        res.status(500).json({ error: `Failed to fetch stream data: ${error.message}` });
    }
});


// ENDPOINT 2: /api/analyze_video (UPGRADED with Stream Links)
async function generateLlmReport(videoId) {
    const results = await Promise.allSettled([getVideoDetails(videoId), getComments(videoId), getTranscript(videoId)]);
    const [detailsResult, commentsResult, transcriptResult] = results;
    if (detailsResult.status === 'rejected') { const reason = detailsResult.reason?.message || 'Could not fetch video details'; return `Fatal Error: ${reason}`; }
    const details = detailsResult.value;
    let channelDetails = {};
    if (details.authorId) { try { channelDetails = await getChannelDetails(details.authorId); } catch (e) {} }
    let transcriptText = "Transcript not available.";
    if (transcriptResult.status === 'fulfilled') { /* ... (no changes) ... */ }
    let topCommentsText = "No comments available or failed to fetch.";
    if (commentsResult.status === 'fulfilled' && Array.isArray(commentsResult.value.comments)) { /* ... (no changes) ... */ }

    // --- NEW: Generate stream links for the report ---
    const streams = getFormattedStreams(details);
    let streamText = "Stream links not available.";
    const formatLinkList = (list) => list.map(s => `- ${s.quality} (${s.type}): ${s.url}`).join('\n');
    
    if (streams.video_with_audio.length > 0 || streams.video_only.length > 0 || streams.audio_only.length > 0) {
        streamText = `**Video + Audio Combined:**\n${streams.video_with_audio.length > 0 ? formatLinkList(streams.video_with_audio) : '  - None available'}\n\n` +
                     `**Video Only (DASH):**\n${streams.video_only.length > 0 ? formatLinkList(streams.video_only) : '  - None available'}\n\n` +
                     `**Audio Only (DASH):**\n${streams.audio_only.length > 0 ? formatLinkList(streams.audio_only) : '  - None available'}`;
    }

    return `**YouTube Video Analysis Report**\n\n**1. Basic Information:**\n- **Title:** ${details.title || 'N/A'}\n- **Views:** ${formatNumber(details.viewCount)}\n- **Likes:** ${formatNumber(details.likeCount)}\n- **Uploaded On:** ${formatDate(details.published)}\n\n**2. Channel Details:**\n- **Channel Name:** ${details.author || 'N/A'}\n- **Subscribers:** ${formatNumber(channelDetails.subCount)}\n- **Channel ID:** ${details.authorId || 'N/A'}\n\n**3. Video Description:**\n${details.description ? details.description.trim() : 'No description provided.'}\n\n**4. Video Transcript (What is being said):**\n${transcriptText}\n\n**5. Public Opinion (Top 20 Comments):**\n${topCommentsText}\n\n**6. Available Streams & Downloads:**\n${streamText}\n\n**--- End of Report ---**`.trim();
}

app.get('/api/analyze_video', async (req, res) => { /* ... (no changes needed) ... */ });


// ENDPOINT 3: /api/analyze_search
async function generateLlmSearchReport(query) { /* ... (no changes needed) ... */ }
app.get('/api/analyze_search', async (req, res) => { /* ... (no changes needed) ... */ });


// ==========================================================
//  5. START THE SERVER
// ==========================================================
app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
});


// ==========================================================
// FULL CODE OF HIDDEN FUNCTIONS FOR COMPLETENESS
// ==========================================================
function parseWebVTT(vttString) { if (typeof vttString !== 'string') return []; const lines = vttString.split('\n'); const transcript = []; for (let i = 0; i < lines.length; i++) { if (lines[i].includes('-->')) { const timeParts = lines[i].split(' --> '); const startTime = timeParts[0]; const timeSegments = startTime.split(':'); const seconds = parseInt(timeSegments[0], 10) * 3600 + parseInt(timeSegments[1], 10) * 60 + parseFloat(timeSegments[2]); let text = ''; let j = i + 1; while (j < lines.length && lines[j] !== '') { text += lines[j] + ' '; j++; } transcript.push({ start: seconds * 1000, text: text.trim() }); i = j; } } return transcript; }
function formatDuration(totalSeconds) { if (totalSeconds == null || isNaN(totalSeconds)) return "N/A"; if (totalSeconds < 60) return `${totalSeconds} seconds`; const hours = Math.floor(totalSeconds / 3600); const minutes = Math.floor((totalSeconds % 3600) / 60); const seconds = totalSeconds % 60; const paddedMinutes = String(minutes).padStart(2, '0'); const paddedSeconds = String(seconds).padStart(2, '0'); if (hours > 0) { return `${hours}:${paddedMinutes}:${paddedSeconds}`; } else { return `${minutes}:${paddedSeconds}`; } }
function formatTimestamp(totalSeconds) { if (totalSeconds == null || isNaN(totalSeconds)) return "00:00"; const hours = Math.floor(totalSeconds / 3600); const minutes = Math.floor((totalSeconds % 3600) / 60); const seconds = Math.floor(totalSeconds % 60); const paddedMinutes = String(minutes).padStart(2, '0'); const paddedSeconds = String(seconds).padStart(2, '0'); if (hours > 0) { return `${hours}:${paddedMinutes}:${paddedSeconds}`; } else { return `${minutes}:${paddedSeconds}`; } }
async function getTranscript(videoId) { const captionsUrl = `${INVIDIOUS_API_BASE}/videos/${videoId}?fields=captions`; const captionsResponse = await axios.get(captionsUrl); const captions = captionsResponse.data.captions; if (!captions || captions.length === 0) { throw new Error("No captions available for this video."); } const transcriptPath = captions[0].url; const fullTranscriptUrl = `${INVIDIOUS_DOMAIN}${transcriptPath}`; const transcriptResponse = await axios.get(fullTranscriptUrl); const data = transcriptResponse.data; if (typeof data === 'string') { return parseWebVTT(data); } else if (typeof data === 'object') { if (Array.isArray(data.captions)) return data.captions; if (Array.isArray(data.lines)) return data.lines; if (Array.isArray(data)) return data; } throw new Error("Could not parse transcript from the received data."); }
app.get('/api/fetch', async (req, res) => { const { id: videoId, channel: channelId, search: query } = req.query; const fields = req.query.fields ? req.query.fields.split(',').map(f => f.trim()) : []; if (!videoId && !channelId && !query) { return res.status(400).json({ error: "An 'id', 'channel', or 'search' parameter is required." }); } try { const tasks = []; const responseKeys = []; if (videoId) { if (fields.includes('details')) { tasks.push(getVideoDetails(videoId)); responseKeys.push('details'); } if (fields.includes('comments')) { tasks.push(getComments(videoId)); responseKeys.push('comments'); } if (fields.includes('transcript')) { tasks.push(getTranscript(videoId)); responseKeys.push('transcript'); } } if (channelId && fields.includes('channel')) { tasks.push(getChannelDetails(channelId)); responseKeys.push('channel'); } if (query) { tasks.push(performSearch(query)); responseKeys.push('search_results'); } if (tasks.length === 0) { return res.status(400).json({ error: "No valid fields or parameters provided." }); } const results = await Promise.allSettled(tasks); const finalResponse = {}; results.forEach((result, index) => { const key = responseKeys[index]; if (result.status === 'fulfilled') { finalResponse[key] = result.value; } else { finalResponse[key] = { error: `Failed to fetch ${key}`, details: result.reason?.message || 'Unknown error' }; } }); res.json(finalResponse); } catch (error) { res.status(500).json({ error: "An unexpected server error occurred.", details: error.message }); } });
app.get('/api/analyze_video', async (req, res) => { const { v: videoId } = req.query; if (!videoId) { return res.status(400).json({ error: "A video ID is required." }); } try { const report = await generateLlmReport(videoId); res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.send(report); } catch (error) { res.status(500).send(`An unexpected server error occurred: ${error.message}`); } });
async function generateLlmSearchReport(query) { const searchResults = await performSearch(query); if (!searchResults || searchResults.length === 0) { return { message: "No search results found.", results: [] }; } const formattedResults = searchResults.map(item => { if (item.type === 'video') { const propertyMap = { liveNow: 'Live Now', isUpcoming: 'Upcoming', premium: 'Premium Content', isNew: 'New Video', is4k: '4K Quality', is8k: '8K Quality', isVr180: 'VR180 Video', isVr360: '360° Video', is3d: '3D Video', hasCaptions: 'Has Captions' }; const specialProperties = []; for (const key in propertyMap) { if (item[key] === true) { specialProperties.push(propertyMap[key]); } } return { type: 'video', title: item.title, videoId: item.videoId, uploadDate: item.publishedText || 'N/A', views: formatNumber(item.viewCount), length: formatDuration(item.lengthSeconds), channelName: item.author, isVerified: item.authorVerified || false, specialProperties: specialProperties }; } else if (item.type === 'channel') { return { type: 'channel', name: item.author, channelId: item.authorId, handle: item.channelHandle || 'N/A', isVerified: item.authorVerified || false, subscribers: formatNumber(item.subCount), videoCount: formatNumber(item.videoCount), description: item.description || 'No description available.', }; } else if (item.type === 'playlist') { return { type: 'playlist', title: item.title, playlistId: item.playlistId, videoCount: item.videoCount, author: item.author, }; } return null; }).filter(Boolean); return { results: formattedResults }; }
app.get('/api/analyze_search', async (req, res) => { const { q: query } = req.query; if (!query) { return res.status(400).json({ error: "A search query 'q' is required." }); } try { const report = await generateLlmSearchReport(query); res.json(report); } catch (error) { res.status(500).json({ error: `An unexpected error occurred during search: ${error.message}` }); } });
if (commentsResult.status === 'fulfilled' && Array.isArray(commentsResult.value.comments)) { topCommentsText = commentsResult.value.comments .sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0)) .slice(0, 20) .map(c => `- **${c.author || 'Anonymous'}** (${formatNumber(c.likeCount)} likes): ${c.content ? c.content.trim() : ''}`) .join('\n'); }
